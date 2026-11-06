import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, type Db } from "@/db/client";
import { allocationEvents, allocations, documents, equipmentModels, equipmentUnits, handoverPhotos, handovers, incidents, requests, unitInspections } from "@/db/schema";
import { requestPayloadSchema } from "@/lib/validation/request";
import { createPreorder } from "@/server/preorders";
import {
  allocateUnits, attachSignedBon, cancelReservation, changeStatus, createQuote, recordDelivery, recordInspection, recordReturn, resolveIncident, savePlanning,
  type Actor, type DeliveryInput, type ReturnInput,
} from "@/server/request-ops";
import { availableUnits } from "@/server/admin-data";
import { generateBon } from "@/server/documents";
import { createAdminUser } from "@/server/passwords";
import { decryptFile } from "@/server/file-crypto";
import { resetTestDb } from "../support/db";
import { validPayload } from "../support/fixtures";
import { ALL_CHECKS_OK, createInspectedUnits, inspect } from "../support/units";

let db: Db;
let admin: Actor;
let preparateur: Actor;
let commercial: Actor;
let modelA: string;
let modelB: string;
const code = async (c: string) => (await db.select().from(equipmentUnits).where(eq(equipmentUnits.inventoryCode, c)))[0];
const DAY = 86400_000;
const CHECKS = { stock: true, zone: true, electricite: true, devis: true, creneau: true };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const PDF = Buffer.from("%PDF-1.4\n% bon signé (test)\n%%EOF\n");

beforeAll(async () => {
  db = await resetTestDb();
  process.env.EMAIL_DRIVER = "file";
  process.env.MAIL_OUTBOX_DIR = path.resolve("test-results/mail");
  process.env.FILE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  admin = { id: (await createAdminUser(db, { email: "s-admin@test.invalid", name: "Admin", password: "mot-de-passe-solide-1" })).id, role: "admin" };
  preparateur = { id: (await createAdminUser(db, { email: "s-prep@test.invalid", name: "Prép", password: "mot-de-passe-solide-2", role: "preparateur" })).id, role: "preparateur" };
  commercial = { id: (await createAdminUser(db, { email: "s-com@test.invalid", name: "Com", password: "mot-de-passe-solide-3", role: "commercial" })).id, role: "commercial" };
  modelA = (await db.insert(equipmentModels).values({ service: "chauffage", brand: "VARMA", model: "Ingaro", manufacturerRef: "244177", electricalPowerW: 2000, noticeVersion: "Notice Ingaro" }).returning())[0].id;
  modelB = (await db.insert(equipmentModels).values({ service: "chauffage", brand: "AutreMarque", model: "B1500", electricalPowerW: 1500, noticeVersion: "Notice B1500" }).returning())[0].id;
  await createInspectedUnits(db, admin, [
    ...Array.from({ length: 8 }, (_, i) => ({ inventoryCode: `RC-00${i + 1}`, modelId: modelA, lotNumber: "LOT-A" })),
    { inventoryCode: "RC-009", modelId: modelA, lotNumber: "LOT-A", decision: "hors_service" as const },
    { inventoryCode: "RC-010", modelId: modelB, decision: "bon" as const },
  ]);
});
afterAll(() => closeDb());

async function confirmed(qty: number, deliveryAt: Date, pickupAt: Date | null) {
  const p = requestPayloadSchema.parse({ ...validPayload(), idempotencyKey: randomUUID(),
    heating: { surfaceMode: "total", totalSurfaceM2: 20 * qty, rooms: qty, ceilingHeightM: 2.5, insulation: "bonne", quantityRequested: qty } });
  const r = await createPreorder(db, p);
  await changeStatus(db, admin, r.id, "a_qualifier", "", {});
  await createQuote(db, admin, r.id, [{ label: "Location", quantity: qty, unitHtCents: 5900 }], "");
  await changeStatus(db, admin, r.id, "devis_a_confirmer", "", {});
  expect((await savePlanning(db, admin, r.id, { confirmedDeliveryAt: deliveryAt, confirmedDeliverySlot: null, plannedPickupAt: pickupAt, equipmentModelId: modelA, quantityConfirmed: qty, technicalNote: null, nextActionAt: null, logisticsCostCents: null, handlingMinutes: null, distanceKm: null, incidentCostCents: null, incidentNote: null })).ok).toBe(true);
  expect((await changeStatus(db, admin, r.id, "confirmee", "", CHECKS)).ok).toBe(true);
  return r;
}
const openOf = async (requestId: string) => db.select().from(allocations).where(and(eq(allocations.requestId, requestId), sql`${allocations.status} IN ('reservee','remise')`));
async function noticesFor(allocIds: string[], given = true) {
  const rows = await db.select({ m: equipmentUnits.modelId }).from(allocations).innerJoin(equipmentUnits, eq(allocations.unitId, equipmentUnits.id)).where(sql`${allocations.id} IN ${allocIds}`);
  return Object.fromEntries(rows.map((r) => [r.m, given]));
}
async function deliver(id: string, allocIds: string[], at: Date, extra: Partial<DeliveryInput> = {}) {
  return recordDelivery(db, preparateur, id, {
    occurredAt: at, agentName: "Livreur", recipientName: "Bruno Leroy", allocationIds: allocIds, notices: await noticesFor(allocIds), signature: "signe",
    reserves: "", quantityJustification: "", incidentDescription: "", incidentInstructions: "", photos: [], signedScan: { contentType: "application/pdf", bytes: PDF }, ...extra,
  });
}
const ret = (id: string, items: ReturnInput["items"], at: Date, extra: Partial<ReturnInput> = {}) =>
  recordReturn(db, preparateur, id, { occurredAt: at, agentName: "Livreur", recipientName: "Bruno Leroy", items, generalCondition: "conforme", reserves: "", signature: "signe", incidentDescription: "", incidentInstructions: "", photos: [], ...extra });
/** Erreur PostgreSQL d'un déclencheur (Drizzle la place dans `cause`). */
async function dbError(p: Promise<unknown>) {
  try { await p; } catch (e) { return String((e as { cause?: Error }).cause?.message ?? (e as Error).message); }
  return "AUCUNE ERREUR";
}
const avail = async () => (await availableUnits(db, "chauffage")).map((u) => u.inventory_code);

describe("P0-1 — disponibilité physique", () => {
  it("retard de 7 jours + commande concurrente : RC-001 ne peut pas être promis ; disponible seulement après reprise ET contrôle", async () => {
    const now = Date.now();
    const A = await confirmed(1, new Date(now - 14 * DAY), new Date(now - 7 * DAY));
    const rc1 = await code("RC-001");
    expect((await allocateUnits(db, admin, A.id, [rc1.id])).ok).toBe(true);
    const [aAlloc] = await openOf(A.id);
    expect((await deliver(A.id, [aAlloc.id], new Date(now - 14 * DAY))).ok).toBe(true);
    const B = await confirmed(1, new Date(now + DAY), new Date(now + 5 * DAY));
    const res = await allocateUnits(db, admin, B.id, [rc1.id]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/RC-001 \(chez le client/);
    expect((await ret(A.id, [{ allocationId: aAlloc.id, condition: "conforme", note: "" }], new Date(now - 60_000))).ok).toBe(true);
    // P0-A : reprise conforme ≠ louable
    expect((await code("RC-001")).condition).toBe("a_controler");
    expect(await avail()).not.toContain("RC-001");
    const blocked = await allocateUnits(db, admin, B.id, [rc1.id]);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/non louable.*RC-001 \(a_controler\)/);
    // contrôle approuvé ⇒ louable
    expect((await inspect(db, preparateur, "RC-001")).ok).toBe(true);
    expect((await code("RC-001")).condition).toBe("bon");
    expect((await allocateUnits(db, admin, B.id, [rc1.id])).ok).toBe(true);
    await cancelReservation(db, admin, (await openOf(B.id))[0].id, "Nettoyage du test");
  });

  it("concurrence : deux demandes affectent RC-002 en même temps → une seule réussit", async () => {
    const t = Date.now() + 30 * DAY;
    const X = await confirmed(1, new Date(t), null);
    const Y = await confirmed(1, new Date(t + 60 * DAY), null);
    const rc2 = await code("RC-002");
    const res = await Promise.all([allocateUnits(db, admin, X.id, [rc2.id]), allocateUnits(db, admin, Y.id, [rc2.id])]);
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    for (const r of [X, Y]) for (const a of await openOf(r.id)) await cancelReservation(db, admin, a.id, "Nettoyage du test");
  });

  it("prolongation transactionnelle et tracée ; appareil remis non libérable", async () => {
    const now = Date.now();
    const R = await confirmed(1, new Date(now - 3 * DAY), new Date(now - DAY));
    await allocateUnits(db, admin, R.id, [(await code("RC-003")).id]);
    const [al] = await openOf(R.id);
    await deliver(R.id, [al.id], new Date(now - 3 * DAY));
    const newPickup = new Date(now + 10 * DAY);
    expect((await savePlanning(db, admin, R.id, { confirmedDeliveryAt: new Date(now - 3 * DAY), confirmedDeliverySlot: null, plannedPickupAt: newPickup, equipmentModelId: modelA, quantityConfirmed: 1, technicalNote: null, nextActionAt: null, logisticsCostCents: null, handlingMinutes: null, distanceKm: null, incidentCostCents: null, incidentNote: null })).ok).toBe(true);
    expect((await db.select().from(allocations).where(eq(allocations.id, al.id)))[0].endAt?.getTime()).toBe(newPickup.getTime());
    expect(await db.select().from(allocationEvents).where(and(eq(allocationEvents.allocationId, al.id), eq(allocationEvents.kind, "prolongation")))).toHaveLength(1);
    expect((await cancelReservation(db, admin, al.id, "tentative de libération")).ok).toBe(false);
    expect((await changeStatus(db, admin, R.id, "annulee", "test", {})).ok).toBe(false);
    expect((await changeStatus(db, admin, R.id, "reprise_effective", "", {})).ok).toBe(false);
    await expect(db.update(allocations).set({ status: "annulee", cancelledAt: new Date() }).where(eq(allocations.id, al.id))).rejects.toThrow();
  });
});

describe("Guide de mise en ligne — scénarios de test « clôture » et « annulation »", () => {
  it("annuler une demande confirmée jamais livrée annule ses réservations (tracé) et rend l'appareil affectable sans contrôle", async () => {
    const R = await confirmed(1, new Date(Date.now() + 70 * DAY), null);
    const rc2 = await code("RC-002");
    expect((await allocateUnits(db, admin, R.id, [rc2.id])).ok).toBe(true);
    expect((await changeStatus(db, admin, R.id, "annulee", "Demande de test — annulation", {})).ok).toBe(true);
    const [al] = await db.select().from(allocations).where(eq(allocations.requestId, R.id));
    expect(al.status).toBe("annulee");
    expect(await db.select().from(allocationEvents).where(and(eq(allocationEvents.allocationId, al.id), eq(allocationEvents.kind, "annulation")))).toHaveLength(1);
    expect((await code("RC-002")).condition).toBe("neuf"); // jamais sorti : pas de contrôle requis
    expect(await avail()).toContain("RC-002");
  });
});

describe("P0-A — contrôle technique avant toute nouvelle location", () => {
  it("ni l'application ni la base ne permettent de rendre un appareil louable sans contrôle", async () => {
    const rc9 = await code("RC-009"); // hors service
    expect(await dbError(db.update(equipmentUnits).set({ condition: "bon" }).where(eq(equipmentUnits.id, rc9.id)))).toMatch(/Contrôle technique requis/);
    expect(await dbError(db.insert(equipmentUnits).values({ inventoryCode: "RC-999", modelId: modelA, condition: "neuf" }))).toMatch(/à contrôler/);
    // contrôle incomplet ⇒ refus de « bon »
    const partial = await inspect(db, admin, "RC-009", "bon", { ...ALL_CHECKS_OK, cordon_fiche: false });
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.error).toMatch(/Tous les points de contrôle/);
    // rôle commercial non habilité
    const byCom = await recordInspection(db, commercial, rc9.id, { inspectedAt: new Date(), inspectorName: "X", checks: ALL_CHECKS_OK, anomalies: "", decision: "bon" });
    expect(byCom.ok).toBe(false);
    // hors service exige des anomalies ; inspection immuable
    expect((await recordInspection(db, admin, rc9.id, { inspectedAt: new Date(), inspectorName: "X", checks: {}, anomalies: "", decision: "hors_service" })).ok).toBe(false);
    const [last] = await db.select().from(unitInspections).where(eq(unitInspections.unitId, rc9.id));
    await expect(db.update(unitInspections).set({ decision: "bon" }).where(eq(unitInspections.id, last.id))).rejects.toThrow();
    await expect(db.delete(unitInspections).where(eq(unitInspections.id, last.id))).rejects.toThrow();
  });
});

describe("P0-B — preuve de remise : notice par modèle, signature, incidents, scan chiffré", () => {
  it("remise conforme : bon signé + notices ; scan stocké chiffré et restitué à l'identique", async () => {
    const R = await confirmed(1, new Date(Date.now() - 2 * DAY), null);
    await allocateUnits(db, admin, R.id, [(await code("RC-004")).id]);
    const [a] = await openOf(R.id);
    const res = await deliver(R.id, [a.id], new Date(Date.now() - DAY));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.message).toMatch(/remise conforme/);
    const [h] = await db.select().from(handovers).where(eq(handovers.requestId, R.id));
    expect(h.outcome).toBe("conforme");
    expect(h.signature).toBe("signe");
    const [scan] = await db.select().from(handoverPhotos).where(and(eq(handoverPhotos.handoverId, h.id), eq(handoverPhotos.kind, "bon_signe")));
    expect(scan.encryption).toBe("aes-256-gcm:v1");
    expect(scan.content.includes(Buffer.from("%PDF"))).toBe(false); // pas de clair en base
    expect(decryptFile(scan.content, scan.encryption).equals(PDF)).toBe(true);
    await expect(db.delete(handoverPhotos).where(eq(handoverPhotos.id, scan.id))).rejects.toThrow();
    // la base refuse un « conforme » sans signature
    await expect(db.insert(handovers).values({ requestId: R.id, kind: "remise", occurredAt: new Date(Date.now() - DAY), agentName: "x", recipientName: "y", quantity: 1, noticeGiven: true, signature: "refus", outcome: "conforme", recordedBy: admin.id })).rejects.toThrow();
  });

  it("notice NON remise et refus de signature : incident obligatoire, jamais « conforme », résolution tracée par un admin", async () => {
    const R = await confirmed(2, new Date(Date.now() - 2 * DAY), null);
    await allocateUnits(db, admin, R.id, [(await code("RC-005")).id, (await code("RC-010")).id], { mixedJustification: "Dépannage : modèle B accepté par le client" });
    const open = await openOf(R.id);
    const notices = await noticesFor(open.map((x) => x.id));
    notices[modelB] = false; // notice du 2e modèle oubliée
    const noIncident = await deliver(R.id, open.map((x) => x.id), new Date(Date.now() - DAY), { notices, signature: "refus", signedScan: null });
    expect(noIncident.ok).toBe(false);
    if (!noIncident.ok) expect(noIncident.error).toMatch(/Incident : décrivez/);
    const missingModel = await deliver(R.id, open.map((x) => x.id), new Date(Date.now() - DAY), { notices: { [modelA]: true }, signedScan: null });
    expect(missingModel.ok).toBe(false); // notice du modèle B non renseignée
    const ok = await deliver(R.id, open.map((x) => x.id), new Date(Date.now() - DAY), {
      notices, signature: "refus", signedScan: null,
      incidentDescription: "Le locataire refuse de signer ; notice B1500 restée au dépôt.",
      incidentInstructions: "Déposer la notice B1500 demain et faire contresigner le bon.",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.message).toMatch(/INCIDENT ouvert.*scan du bon signé/);
    const [h] = await db.select().from(handovers).where(eq(handovers.requestId, R.id));
    expect(h.outcome).toBe("incident");
    expect(h.noticeGiven).toBe(false);
    expect((h.notices as Record<string, { given: boolean }>)[modelB].given).toBe(false);
    const incs = await db.select().from(incidents).where(eq(incidents.requestId, R.id));
    expect(incs.map((i) => i.kind).sort()).toEqual(["notice_non_remise", "refus_signature"]);
    expect(incs.every((i) => i.status === "ouvert" && i.description.includes("refuse"))).toBe(true);
    // résolution : admin uniquement, motif requis, puis immuable
    expect((await resolveIncident(db, preparateur, incs[0].id, "Notice déposée")).ok).toBe(false);
    expect((await resolveIncident(db, admin, incs[0].id, "")).ok).toBe(false);
    expect((await resolveIncident(db, admin, incs[0].id, "Notice B1500 déposée le lendemain, bon contresigné")).ok).toBe(true);
    await expect(db.update(incidents).set({ resolutionNote: "réécrit" }).where(eq(incidents.id, incs[0].id))).rejects.toThrow();
    await expect(db.update(incidents).set({ description: "réécrit" }).where(eq(incidents.id, incs[1].id))).rejects.toThrow();
    // scan déposé après coup, refus d'un faux PDF
    expect((await attachSignedBon(db, preparateur, h.id, { contentType: "application/pdf", bytes: Buffer.from("pas un pdf") })).ok).toBe(false);
    expect((await attachSignedBon(db, preparateur, h.id, { contentType: "image/png", bytes: PNG })).ok).toBe(true);
    // reprise avec signature non recueillie : incident également
    const r1 = await ret(R.id, open.map((x) => ({ allocationId: x.id, condition: "conforme" as const, note: "" })), new Date(), { signature: "non_recueilli" });
    expect(r1.ok).toBe(false);
    const r2 = await ret(R.id, open.map((x) => ({ allocationId: x.id, condition: "conforme" as const, note: "" })), new Date(), {
      signature: "non_recueilli", incidentDescription: "Logement vide à la reprise, gardien présent", incidentInstructions: "Faire signer le donneur d'ordre",
    });
    expect(r2.ok).toBe(true);
    expect((await db.select().from(incidents).where(and(eq(incidents.requestId, R.id), eq(incidents.kind, "signature_non_recueillie"))))).toHaveLength(1);
  });
});

describe("P0-2 — parcours complet avec contrôle", () => {
  it("3 appareils → remise réelle → reprise partielle (1 dégradé) → reprise complète → contrôles → parc disponible", async () => {
    for (const c of ["RC-005", "RC-010"]) expect((await inspect(db, admin, c)).ok).toBe(true); // repris à l'étape P0-B, contrôlés ici
    expect((await inspect(db, admin, "RC-004")).ok).toBe(false); // RC-004 est toujours chez un client : contrôle impossible
    const del = new Date("2026-10-20T07:30:00Z");
    const R = await confirmed(3, del, new Date("2026-10-30T09:00:00Z"));
    const units = await Promise.all(["RC-006", "RC-007", "RC-008"].map(code));
    expect((await allocateUnits(db, admin, R.id, units.map((u) => u.id))).ok).toBe(true);
    const open = await openOf(R.id);
    expect((await generateBon(db, R.id, admin.id)).ok).toBe(true);
    expect((await deliver(R.id, open.map((a) => a.id), del)).ok).toBe(true);
    const req = (await db.select().from(requests).where(eq(requests.id, R.id)))[0];
    expect(req.status).toBe("livree");
    expect(req.deliveredAt?.toISOString()).toBe(del.toISOString());
    const byUnit = Object.fromEntries(open.map((a) => [a.unitId, a.id]));
    const p1 = await ret(R.id, [
      { allocationId: byUnit[units[0].id], condition: "conforme", note: "" },
      { allocationId: byUnit[units[1].id], condition: "degrade", note: "Pied cassé" },
    ], new Date("2026-10-31T08:00:00Z"), { reserves: "1 appareil non rendu" });
    expect(p1.ok).toBe(true);
    if (p1.ok) expect(p1.message).toMatch(/partielle.*1 appareil.*2 appareil\(s\) en attente de contrôle/);
    expect((await db.select().from(requests).where(eq(requests.id, R.id)))[0].status).toBe("livree");
    expect((await code("RC-006")).condition).toBe("a_controler");
    expect((await code("RC-007")).condition).toBe("a_controler");
    expect(await avail()).not.toContain("RC-006"); // reprise conforme ≠ louable
    expect(await avail()).not.toContain("RC-008"); // toujours chez le client
    expect((await ret(R.id, [{ allocationId: byUnit[units[2].id], condition: "conforme", note: "" }], new Date("2026-11-02T15:00:00Z"))).ok).toBe(true);
    expect((await db.select().from(requests).where(eq(requests.id, R.id)))[0].status).toBe("reprise_effective");
    // contrôles : un positif, un hors service (dégradé), un positif
    expect((await inspect(db, preparateur, "RC-006")).ok).toBe(true);
    expect((await inspect(db, preparateur, "RC-007", "hors_service", { ...ALL_CHECKS_OK, boitier_stabilite: false })).ok).toBe(true);
    expect((await inspect(db, preparateur, "RC-008")).ok).toBe(true);
    const a = await avail();
    expect(a).toContain("RC-006");
    expect(a).toContain("RC-008");
    expect(a).not.toContain("RC-007");
    // deux traces distinctes : reprise physique ET contrôle
    const ev = await db.select().from(allocationEvents).where(and(eq(allocationEvents.requestId, R.id), eq(allocationEvents.unitId, units[0].id)));
    expect(ev.map((e) => e.kind)).toEqual(expect.arrayContaining(["reservation", "remise", "reprise", "controle"]));
    // « neuf » interdit après une location
    const neuf = await recordInspection(db, admin, (await code("RC-007")).id, { inspectedAt: new Date(), inspectorName: "X", checks: ALL_CHECKS_OK, anomalies: "", decision: "neuf" });
    expect(neuf.ok).toBe(false);
    expect((await changeStatus(db, admin, R.id, "cloturee", "", {})).ok).toBe(true);
    // demande livrée puis clôturée : l'annulation est refusée (cf. guide, étape 8)
    expect((await changeStatus(db, admin, R.id, "annulee", "test", {})).ok).toBe(false);
  });

  it("refuse une date réelle future, une reprise antérieure à la remise, un écart non justifié, une photo invalide", async () => {
    const R = await confirmed(2, new Date(Date.now() - 2 * DAY), null);
    await allocateUnits(db, admin, R.id, [(await code("RC-006")).id, (await code("RC-008")).id]);
    const open = await openOf(R.id);
    expect((await deliver(R.id, open.map((a) => a.id), new Date(Date.now() + 3 * DAY))).ok).toBe(false);
    const partial = await deliver(R.id, [open[0].id], new Date(Date.now() - DAY));
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.error).toMatch(/justification/);
    expect((await deliver(R.id, [open[0].id], new Date(Date.now() - DAY), { quantityJustification: "Un logement inaccessible ce jour" })).ok).toBe(true);
    expect((await ret(R.id, [{ allocationId: open[0].id, condition: "conforme", note: "" }], new Date(Date.now() - 2 * DAY))).ok).toBe(false);
    expect((await ret(R.id, [{ allocationId: open[0].id, condition: "conforme", note: "" }], new Date(), { photos: [{ contentType: "image/png", bytes: Buffer.from("x") }] })).ok).toBe(false);
  });
});

describe("P0-3 / P1-B — cohérence quantité / modèles / état et exécution partielle", () => {
  it("refus : hors service, doublons, autre modèle non justifié, dépassement ; bon multi-lignes avec « reste à livrer »", async () => {
    const R = await confirmed(3, new Date(Date.now() + 50 * DAY), null);
    const [u4, u5, u9, u10] = await Promise.all(["RC-001", "RC-002", "RC-009", "RC-010"].map(code));
    const hs = await allocateUnits(db, admin, R.id, [u4.id, u5.id, u9.id]);
    expect(hs.ok).toBe(false);
    if (!hs.ok) expect(hs.error).toMatch(/RC-009 \(hors_service\)/);
    expect(await openOf(R.id)).toHaveLength(0);
    expect((await allocateUnits(db, admin, R.id, [u4.id, u4.id])).ok).toBe(false);
    const mixed = await allocateUnits(db, admin, R.id, [u4.id, u10.id]);
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.error).toMatch(/Lot mixte/);
    expect((await allocateUnits(db, admin, R.id, [u4.id, u5.id, u10.id, (await code("RC-005")).id], { mixedJustification: "Dépannage : modèle B accepté" })).ok).toBe(false);
    expect((await allocateUnits(db, admin, R.id, [u4.id, u10.id], { mixedJustification: "Dépannage : modèle B accepté par le client" })).ok).toBe(true);
    expect((await generateBon(db, R.id, admin.id)).ok).toBe(false);
    const g = await generateBon(db, R.id, admin.id, "Troisième appareil livré sous 48 h");
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const [doc] = await db.select().from(documents).where(eq(documents.id, g.id));
    mkdirSync("test-results/pdf", { recursive: true });
    writeFileSync("test-results/pdf/bon-lot-mixte.pdf", doc.content);
    const text = execFileSync("pdftotext", ["-layout", "test-results/pdf/bon-lot-mixte.pdf", "-"]).toString().replace(/\s+/g, " ");
    expect(text).toContain("VARMA / Ingaro / 244177");
    expect(text).toContain("AutreMarque / B1500");
    expect(text).toContain("Notice Ingaro");
    expect(text).toContain("Notice B1500"); // notice par modèle
    expect(text).toMatch(/Quantité confirmée : 3 · préparée sur ce bon : 2 · reste à livrer : 1 \(commande partiellement exécutée\)/);
    expect(text).toContain("La quantité EFFECTIVEMENT remise est celle inscrite ci-dessous");
    expect(text).toContain("Refus de signer");
    expect(execFileSync("pdfinfo", ["test-results/pdf/bon-lot-mixte.pdf"]).toString()).toMatch(/Pages:\s+1/);
  });
});
