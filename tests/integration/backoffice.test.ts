import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, type Db } from "@/db/client";
import { adminUsers, documents, equipmentModels, equipmentUnits, requests, statusEvents } from "@/db/schema";
import { requestPayloadSchema } from "@/lib/validation/request";
import { createPreorder } from "@/server/preorders";
import { allocateUnits, changeStatus, createQuote, savePlanning, type Actor } from "@/server/request-ops";
import { generateBon } from "@/server/documents";
import { login, sessionFromToken } from "@/server/auth";
import { createAdminUser } from "@/server/passwords";
import { resetTestDb } from "../support/db";
import { validPayload } from "../support/fixtures";
import { createInspectedUnits } from "../support/units";

let db: Db;
let admin: Actor;
let commercial: Actor;
let modelId: string;
const OUT = path.resolve("test-results/pdf");

const ALL_CHECKS = { stock: true, zone: true, electricite: true, devis: true, creneau: true };

beforeAll(async () => {
  db = await resetTestDb();
  process.env.EMAIL_DRIVER = "file";
  process.env.MAIL_OUTBOX_DIR = path.resolve("test-results/mail");
  mkdirSync(OUT, { recursive: true });
  const a = await createAdminUser(db, { email: "admin@test.invalid", name: "Admin Test", password: "mot-de-passe-solide-123" });
  const c = await createAdminUser(db, { email: "com@test.invalid", name: "Commercial", password: "mot-de-passe-solide-456", role: "commercial" });
  admin = { id: a.id, role: "admin" };
  commercial = { id: c.id, role: "commercial" };
  const [m] = await db.insert(equipmentModels).values({ service: "chauffage", brand: "VARMA", model: "Ingaro", manufacturerRef: "244177", electricalPowerW: 2000, noticeVersion: "Notice fabricant (test)" }).returning();
  modelId = m.id;
  await createInspectedUnits(db, admin, Array.from({ length: 20 }, (_, i) => ({ inventoryCode: `RC-${String(i + 1).padStart(3, "0")}`, modelId, lotNumber: "LOT-TEST-A" })));
});
afterAll(() => closeDb());

async function confirmedRequest(qty: number) {
  const p = requestPayloadSchema.parse({
    ...validPayload(),
    idempotencyKey: randomUUID(),
    heating: { surfaceMode: "total", totalSurfaceM2: 20 * qty, rooms: qty, ceilingHeightM: 2.5, insulation: "bonne", quantityRequested: qty },
    site: { placeType: qty > 8 ? "copropriete" : "appartement", elevator: "oui", floor: "2", multiSite: false },
  });
  const r = await createPreorder(db, p);
  expect((await changeStatus(db, admin, r.id, "a_qualifier", "Appel client", {})).ok).toBe(true);
  expect((await createQuote(db, admin, r.id, [{ label: "Location 8-14 j", quantity: qty, unitHtCents: 8800 }, { label: "Livraison + reprise", quantity: 1, unitHtCents: 11900 }], "")).ok).toBe(true);
  expect((await changeStatus(db, admin, r.id, "devis_a_confirmer", "", {})).ok).toBe(true);
  await savePlanning(db, admin, r.id, {
    confirmedDeliveryAt: new Date("2026-11-20T08:00:00Z"), confirmedDeliverySlot: "9h-11h", plannedPickupAt: new Date("2026-12-04T09:00:00Z"),
    equipmentModelId: modelId, technicalNote: "Tableau vérifié par le client", nextActionAt: null,
    logisticsCostCents: 4000, handlingMinutes: 45, distanceKm: 18, incidentCostCents: null, incidentNote: null,
  });
  return r;
}

describe("back-office : statuts et droits", () => {
  it("le commercial ne peut pas confirmer ; l'admin oui, après contrôles", async () => {
    const r = await confirmedRequest(3);
    const denied = await changeStatus(db, commercial, r.id, "confirmee", "", ALL_CHECKS);
    expect(denied.ok).toBe(false);
    const incomplete = await changeStatus(db, admin, r.id, "confirmee", "", { ...ALL_CHECKS, electricite: false });
    expect(incomplete.ok).toBe(false);
    const ok = await changeStatus(db, admin, r.id, "confirmee", "Stock et créneau OK", ALL_CHECKS);
    expect(ok.ok).toBe(true);
    const ev = await db.select().from(statusEvents).where(eq(statusEvents.requestId, r.id));
    expect(ev.map((e) => e.toStatus)).toEqual(["nouvelle_demande", "a_qualifier", "devis_a_confirmer", "confirmee"]);
    expect(ev.at(-1)!.actorId).toBe(admin.id);
    expect(ev.at(-1)!.note).toBe("Stock et créneau OK");
  });

  it("la confirmation exige un créneau de livraison", async () => {
    const p = requestPayloadSchema.parse({ ...validPayload(), idempotencyKey: randomUUID() });
    const r = await createPreorder(db, p);
    await changeStatus(db, admin, r.id, "a_qualifier", "", {});
    await createQuote(db, admin, r.id, [{ label: "x", quantity: 1, unitHtCents: 100 }], "");
    await changeStatus(db, admin, r.id, "devis_a_confirmer", "", {});
    const res = await changeStatus(db, admin, r.id, "confirmee", "", ALL_CHECKS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/créneau/);
  });
});

describe("bon de remise et de reprise (PDF)", () => {
  it("recettes 7-10 : 3 appareils VARMA/Ingaro 244177, PDF A4 1 page, prérempli sans champs factuels", async () => {
    const r = await confirmedRequest(3);
    await changeStatus(db, admin, r.id, "confirmee", "", ALL_CHECKS);
    const units = await db.select().from(equipmentUnits).orderBy(equipmentUnits.inventoryCode).limit(3);
    expect((await allocateUnits(db, admin, r.id, units.map((u) => u.id))).ok).toBe(true);
    // second request on the same units, same period → refusé
    const r2 = await confirmedRequest(3);
    await changeStatus(db, admin, r2.id, "confirmee", "", ALL_CHECKS);
    const clash = await allocateUnits(db, admin, r2.id, [units[0].id]);
    expect(clash.ok).toBe(false);

    await changeStatus(db, admin, r.id, "preparation", "", {});
    const g = await generateBon(db, r.id, admin.id);
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.number).toMatch(/^BR-\d{4}-\d{6}$/);
    const [doc] = await db.select().from(documents).where(eq(documents.id, g.id));
    expect(doc.content.subarray(0, 5).toString()).toBe("%PDF-");
    const file = path.join(OUT, "bon-3-appareils.pdf");
    writeFileSync(file, doc.content);
    const info = execFileSync("pdfinfo", [file]).toString();
    expect(info).toMatch(/Pages:\s+1/);
    expect(info).toMatch(/595\.\d* x 841\.\d* pts \(A4\)/);
    const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString().replace(/\s+/g, " ");
    const [req] = await db.select().from(requests).where(eq(requests.id, r.id));
    for (const s of [
      "BON DE REMISE ET DE REPRISE", req.reference, g.number,
      "Syndic Test", "73282932000074", "Alice Martin", // donneur d'ordre
      "Bruno Leroy", "07 11 22 33 44", "12 rue Test", // réceptionnaire + adresse
      "VARMA / Ingaro / 244177", "2 000 W", "RC-001, RC-002, RC-003",
      "LOT-TEST-A", "ne les identifie pas individuellement",
      "Je reconnais avoir reçu le matériel indiqué, ainsi que sa notice complète",
      "Lu et approuvé", "Date réelle de remise", "Date réelle de reprise", "Nombre réellement récupéré",
      "conforme", "dégradé", "incomplet", "La personne remettant le matériel", "La personne qui reprend le matériel",
      "Ce bon ne vaut pas autorisation de mise en service", "multiprise", "brûlure",
      "à déterminer selon les conditions de location acceptées",
    ]) expect(text, s).toContain(s);
    expect(text).not.toMatch(/décline toute responsabilité/i);
    expect(text).not.toMatch(/déposant/i);
    expect(text).not.toMatch(/facultati/i);
    expect(text).not.toMatch(/propriétaire/i);
    // Version 2 : même numéro, version incrémentée, v1 archivée intacte
    const g2 = await generateBon(db, r.id, admin.id);
    expect(g2.ok && g2.number).toBe(g.number);
    expect(g2.ok && g2.version).toBe(2);
    await expect(db.update(documents).set({ sha256: "x" }).where(eq(documents.id, g.id))).rejects.toThrow();
  });

  it("au-delà de 12 appareils : annexe d'inventaire sur une 2e page", async () => {
    const r = await confirmedRequest(14);
    await changeStatus(db, admin, r.id, "confirmee", "", ALL_CHECKS);
    // périodes différentes de la demande précédente → on décale le planning
    await savePlanning(db, admin, r.id, {
      confirmedDeliveryAt: new Date("2027-01-10T08:00:00Z"), confirmedDeliverySlot: null, plannedPickupAt: new Date("2027-01-20T08:00:00Z"),
      equipmentModelId: modelId, technicalNote: null, nextActionAt: null, logisticsCostCents: null, handlingMinutes: null, distanceKm: null, incidentCostCents: null, incidentNote: null,
    });
    const units = (await db.select().from(equipmentUnits).orderBy(equipmentUnits.inventoryCode)).slice(3, 17); // RC-004…RC-017 (RC-001…003 restent réservés)
    expect((await allocateUnits(db, admin, r.id, units.map((u) => u.id))).ok).toBe(true);
    const g = await generateBon(db, r.id, admin.id);
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const [doc] = await db.select().from(documents).where(eq(documents.id, g.id));
    const file = path.join(OUT, "bon-14-appareils.pdf");
    writeFileSync(file, doc.content);
    expect(execFileSync("pdfinfo", [file]).toString()).toMatch(/Pages:\s+2/);
    const text = execFileSync("pdftotext", [file, "-"]).toString();
    expect(text).toContain("ANNEXE");
    expect(text).toContain("RC-014");
  });

  it("refuse de générer un bon pour une demande non confirmée", async () => {
    const r = await createPreorder(db, requestPayloadSchema.parse({ ...validPayload(), idempotencyKey: randomUUID() }));
    const g = await generateBon(db, r.id, admin.id);
    expect(g.ok).toBe(false);
  });
});

describe("authentification admin", () => {
  it("connexion, session, verrouillage après 5 échecs", async () => {
    const ok = await login(db, "ADMIN@test.invalid", "mot-de-passe-solide-123", "iphash1");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect((await sessionFromToken(db, ok.token))?.email).toBe("admin@test.invalid");
    expect(await sessionFromToken(db, "jeton-invalide-xxxxxxxxxxxxxxxxxxxx")).toBeNull();
    await db.insert(adminUsers).values({ email: "lock@test.invalid", name: "L", passwordHash: (await import("bcryptjs")).default.hashSync("correct-horse-battery", 4) });
    for (let i = 0; i < 5; i++) await login(db, "lock@test.invalid", "faux-mot-de-passe", `ip${i}`);
    const locked = await login(db, "lock@test.invalid", "correct-horse-battery", "ip9");
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.reason).toBe("locked");
  });
});
