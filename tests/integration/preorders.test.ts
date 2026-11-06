import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb, isConnectionError, type Db } from "@/db/client";
import { allocations, adminUsers, customers, deliverySites, equipmentModels, equipmentUnits, notifications, requests, statusEvents } from "@/db/schema";
import { requestPayloadSchema } from "@/lib/validation/request";
import { createPreorder } from "@/server/preorders";
import { processDueNotifications } from "@/server/notifications";
import { getActiveSettings, publishSettingsVersion } from "@/server/settings-store";
import { defaultBusinessSettings } from "@config/business";
import { resetTestDb } from "../support/db";
import { validPayload } from "../support/fixtures";

let db: Db;
let outbox: string;

const payload = (o: Record<string, unknown> = {}) => requestPayloadSchema.parse({ ...validPayload(), idempotencyKey: randomUUID(), ...o });

beforeAll(async () => {
  db = await resetTestDb();
});
beforeEach(() => {
  outbox = mkdtempSync(path.join(tmpdir(), "rc-mail-"));
  process.env.MAIL_OUTBOX_DIR = outbox;
  process.env.EMAIL_DRIVER = "file";
  process.env.TEAM_NOTIFICATION_EMAIL = "equipe@test.invalid";
});
afterAll(async () => {
  await closeDb();
});

describe("création de précommande", () => {
  it("recette 2 : pro pour une autre adresse et un autre réceptionnaire — données distinctes en base", async () => {
    const r = await createPreorder(db, payload());
    expect(r.reference).toMatch(/^RC-\d{4}-\d{6}$/);
    const [row] = await db.select().from(requests).where(eq(requests.id, r.id));
    const [c] = await db.select().from(customers).where(eq(customers.id, row.customerId));
    const [d] = await db.select().from(deliverySites).where(eq(deliverySites.id, row.deliverySiteId));
    expect(c.contactName).toBe("Alice Martin");
    expect(c.companyName).toBe("Syndic Test");
    expect(c.siret).toBe("73282932000074");
    expect(d.recipientName).toBe("Bruno Leroy");
    expect(d.line1).toBe("12 rue Test");
    expect(row.status).toBe("nouvelle_demande");
    expect(row.termsVersion).toBe(defaultBusinessSettings.legal.termsVersion);
    const ev = await db.select().from(statusEvents).where(eq(statusEvents.requestId, r.id));
    expect(ev).toHaveLength(1);
  });

  it("recette 3 : 5 × 14 jours Lyon figé à 559 € HT / 670,80 € TTC", async () => {
    const r = await createPreorder(db, payload({
      heating: { surfaceMode: "detail", roomSurfaces: [20, 20, 20, 20, 20], ceilingHeightM: 2.5, insulation: "bonne", quantityRequested: 5 },
      schedule: { desiredStartDate: "2026-11-20", durationUnknown: false, estimatedDays: 14, expressRequested: false },
    }));
    const [row] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(row.estimatedTotalHtCents).toBe(55900);
    expect(row.estimatedTotalTtcCents).toBe(67080);
    expect(row.quantityRecommended).toBe(5);
    expect(row.quantityRequested).toBe(5);
  });

  it("idempotence : même clé deux fois = une seule demande", async () => {
    const p = payload();
    const a = await createPreorder(db, p);
    const b = await createPreorder(db, p);
    expect(b.duplicate).toBe(true);
    expect(b.reference).toBe(a.reference);
    const rows = await db.select().from(requests).where(eq(requests.idempotencyKey, p.idempotencyKey));
    expect(rows).toHaveLength(1);
  });

  it("références générées atomiquement, sans doublon en parallèle", async () => {
    const res = await Promise.all(Array.from({ length: 8 }, () => createPreorder(db, payload())));
    expect(new Set(res.map((r) => r.reference)).size).toBe(8);
  });

  it("recette 4 : climatisation → lead complet, « sur devis », aucun prix", async () => {
    const r = await createPreorder(db, payload({
      service: "climatisation",
      heating: undefined,
      cooling: { surfaceM2: 30, rooms: 1, ceilingHeightM: 2.5, exposure: "sud", insulation: "moyenne", people: 3, exhaust: "fenetre", noiseSensitive: false, power: "oui" },
    }));
    const [row] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(row.quoteMode).toBe("sur_devis");
    expect(row.estimatedTotalHtCents).toBeNull();
    expect(row.estimatedTotalTtcCents).toBeNull();
    expect(row.requiresManualReview).toBe(true);
    expect((row.estimateSnapshot as { cooling: { lowW: number } }).cooling.lowW).toBeGreaterThan(0);
  });

  it("un changement de grille n'affecte pas les demandes existantes (prix figé + trigger d'immuabilité)", async () => {
    const r = await createPreorder(db, payload());
    const before = (await db.select().from(requests).where(eq(requests.id, r.id)))[0];
    const changed = structuredClone(defaultBusinessSettings);
    changed.heating.rentalTiers[1].unitPriceHtCents = 9900;
    await publishSettingsVersion(db, changed, null, "test hausse");
    expect((await getActiveSettings(db)).version).toBe(2);
    const after = (await db.select().from(requests).where(eq(requests.id, r.id)))[0];
    expect(after.estimatedTotalHtCents).toBe(before.estimatedTotalHtCents);
    await expect(db.update(requests).set({ estimatedTotalHtCents: 1 }).where(eq(requests.id, r.id))).rejects.toThrow();
    await publishSettingsVersion(db, defaultBusinessSettings, null, "retour v1");
  });
});

describe("notifications (outbox + retry)", () => {
  it("recette 5 : si l'email échoue, la demande est conservée et la notification retentée sans double envoi", async () => {
    process.env.EMAIL_DRIVER = "fail";
    const r = await createPreorder(db, payload());
    const res1 = await processDueNotifications(db, { requestId: r.id });
    expect(res1.every((x) => !x.ok)).toBe(true);
    let ns = await db.select().from(notifications).where(eq(notifications.requestId, r.id));
    expect(ns.map((n) => n.kind).sort()).toEqual(["client_ack", "team_alert"]);
    expect(ns.every((n) => n.status === "failed" && n.attempts === 1)).toBe(true);
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))).toHaveLength(1);

    // Le service revient : on avance l'échéance de retry, deux traitements concurrents.
    process.env.EMAIL_DRIVER = "file";
    await db.update(notifications).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(notifications.requestId, r.id));
    await Promise.all([processDueNotifications(db, { requestId: r.id }), processDueNotifications(db, { requestId: r.id })]);
    ns = await db.select().from(notifications).where(eq(notifications.requestId, r.id));
    expect(ns.every((n) => n.status === "sent")).toBe(true);
    const files = readdirSync(outbox);
    expect(files).toHaveLength(2); // exactement un email client + un email équipe
    // Un nouveau passage n'envoie rien de plus
    await processDueNotifications(db, { requestId: r.id });
    expect(readdirSync(outbox)).toHaveLength(2);
  });

  it("l'email client contient les mentions obligatoires et le réceptionnaire distinct", async () => {
    const r = await createPreorder(db, payload());
    const [ack] = await db.select().from(notifications).where(sql`${notifications.requestId} = ${r.id} AND ${notifications.kind} = 'client_ack'`);
    expect(ack.textBody).toContain(`Votre demande n° ${r.reference} est bien reçue`);
    expect(ack.textBody).toContain("Aucun paiement n'a été effectué");
    expect(ack.textBody).toContain("Réceptionnaire : Bruno Leroy");
    expect(ack.textBody).not.toMatch(/réservation confirmée/i);
    const [team] = await db.select().from(notifications).where(sql`${notifications.requestId} = ${r.id} AND ${notifications.kind} = 'team_alert'`);
    expect(team.textBody).toContain("Donneur d'ordre : Syndic Test — Alice Martin");
    expect(team.textBody).toContain("Réceptionnaire : Bruno Leroy");
  });

  it("passe en « dead » après le nombre maximal de tentatives", async () => {
    process.env.EMAIL_DRIVER = "fail";
    const r = await createPreorder(db, payload());
    for (let i = 0; i < 8; i++) {
      await db.update(notifications).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(notifications.requestId, r.id));
      await processDueNotifications(db, { requestId: r.id });
    }
    const ns = await db.select().from(notifications).where(eq(notifications.requestId, r.id));
    expect(ns.every((n) => n.status === "dead")).toBe(true);
  });
});

describe("panne de base de données", () => {
  it("recette 12 (serveur) : base injoignable → erreur de connexion détectée, aucune demande inventée", async () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://rc@127.0.0.1:1/introuvable";
    process.env.DATABASE_CONNECT_TIMEOUT = "2";
    try {
      const bad = getDb();
      let err: unknown;
      try {
        await createPreorder(bad, payload());
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(isConnectionError(err)).toBe(true);
    } finally {
      await closeDb();
      process.env.DATABASE_URL = saved;
      db = getDb();
    }
  });
});

describe("anti-chevauchement du parc (règle physique, migration 0004)", () => {
  it("un appareil n'a jamais deux affectations ouvertes, même sur des périodes PRÉVUES disjointes ; historique physique sans chevauchement", async () => {
    const [u] = await db.insert(adminUsers).values({ email: "a@test.invalid", name: "A", passwordHash: "x" }).returning();
    const [m] = await db.insert(equipmentModels).values({ service: "chauffage", brand: "B", model: "M" }).returning();
    const [unit] = await db.insert(equipmentUnits).values({ inventoryCode: "RC-901", modelId: m.id, lotNumber: "L1" }).returning();
    const r1 = await createPreorder(db, payload());
    const r2 = await createPreorder(db, payload());
    await db.insert(allocations).values({ requestId: r1.id, unitId: unit.id, startAt: new Date("2026-12-01T08:00:00Z"), endAt: new Date("2026-12-10T08:00:00Z"), createdBy: u.id });
    // période prévue disjointe : refusée tant que la première n'est pas reprise/annulée
    await expect(
      db.insert(allocations).values({ requestId: r2.id, unitId: unit.id, startAt: new Date("2026-12-20T08:00:00Z"), endAt: new Date("2026-12-24T08:00:00Z"), createdBy: u.id }),
    ).rejects.toThrow();
    // historique physique : deux périodes « retournee » qui se chevauchent sont refusées
    const base = { requestId: r2.id, unitId: unit.id, startAt: new Date("2026-01-01T08:00:00Z"), createdBy: u.id, returnVerifiedAt: new Date(), returnCondition: "conforme" } as const;
    await db.insert(allocations).values({ ...base, status: "retournee", deliveredAt: new Date("2026-01-01T08:00:00Z"), returnedAt: new Date("2026-01-10T08:00:00Z") });
    await expect(db.insert(allocations).values({ ...base, status: "retournee", deliveredAt: new Date("2026-01-05T08:00:00Z"), returnedAt: new Date("2026-01-12T08:00:00Z") })).rejects.toThrow();
    // Un même lot ne peut servir d'identifiant : deux appareils du même lot ont des codes distincts
    const [unit2] = await db.insert(equipmentUnits).values({ inventoryCode: "RC-902", modelId: m.id, lotNumber: "L1" }).returning();
    expect(unit2.inventoryCode).not.toBe(unit.inventoryCode);
    await expect(db.insert(equipmentUnits).values({ inventoryCode: "RC-902", modelId: m.id })).rejects.toThrow();
  });
});
