import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  activities, allocationEvents, allocations, equipmentModels, equipmentUnits, handoverItems, handoverPhotos, handovers,
  incidents, quotes, requests, statusEvents, documents, unitInspections,
} from "@/db/schema";
import { encryptFile } from "./file-crypto";
import { checkTransition, TRANSITION_ERROR_TEXT, type RequestStatus, type Role } from "@/lib/domain/status";
import { vatOf } from "@/lib/domain/pricing";
import { getActiveSettings } from "./settings-store";
import { audit } from "./admin-data";
import { sha256 } from "./security";

export type Actor = { id: string; role: Role };
export type OpResult = { ok: true; message?: string; id?: string } | { ok: false; error: string };
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** États d'appareil autorisant une affectation. */
export const RENTABLE_CONDITIONS = ["neuf", "bon"] as const;
export const OPEN_ALLOCATION = ["reservee", "remise"] as const;
const LATE_TOLERANCE_MS = 10 * 60_000;

class OpError extends Error {}
const fail = (m: string): never => { throw new OpError(m); };
async function guarded(fn: () => Promise<OpResult>): Promise<OpResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof OpError) return { ok: false, error: e.message };
    const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return { ok: false, error: "Conflit : un appareil sélectionné est déjà affecté à une autre demande et n'a pas été restitué. Aucune modification n'a été enregistrée." };
    if (code === "23P01") return { ok: false, error: "Conflit de périodes physiques pour un appareil. Aucune modification n'a été enregistrée." };
    if (code === "P0001") return { ok: false, error: (e as Error).message.replace(/^.*?: /, "") };
    throw e;
  }
}

async function openAllocs(tx: Tx | Db, requestId: string) {
  return tx.select().from(allocations).where(and(eq(allocations.requestId, requestId), inArray(allocations.status, [...OPEN_ALLOCATION])));
}

// ───────────────────────── Statuts ─────────────────────────
export async function changeStatus(db: Db, actor: Actor, id: string, to: RequestStatus, note: string, checks: Record<string, boolean>): Promise<OpResult> {
  return guarded(() => db.transaction(async (tx) => {
    const [r] = await tx.select().from(requests).where(eq(requests.id, id)).for("update");
    if (!r) fail("Demande introuvable.");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(quotes).where(eq(quotes.requestId, id));
    const err = checkTransition({ from: r.status, to, role: actor.role, checks, isErp: r.isErp, hasQuote: Number(n) > 0, hasDeliverySlot: !!r.confirmedDeliveryAt });
    if (err) fail(TRANSITION_ERROR_TEXT[err]);

    // Garde-fous fondés sur les FAITS constatés (et non sur un clic)
    const allocs = await tx.select().from(allocations).where(eq(allocations.requestId, id));
    const atClient = allocs.filter((a) => a.status === "remise");
    const hos = await tx.select({ kind: handovers.kind }).from(handovers).where(eq(handovers.requestId, id));
    if (to === "livree" && !hos.some((h) => h.kind === "remise")) fail("Le statut « Livrée » est posé par un constat de remise (date et heure réelles).");
    if (to === "reprise_effective") fail("Le statut « Reprise effectuée » est posé automatiquement par le constat de reprise du dernier appareil.");
    if ((to === "cloturee" || to === "annulee" || to === "refusee") && atClient.length > 0)
      fail(`${atClient.length} appareil(s) encore chez le client : enregistrez d'abord le constat de reprise.`);
    if (to === "refusee" && note.trim().length < 3) fail("Indiquez la raison du refus (utilisée dans les indicateurs).");

    const now = new Date();
    const patch: Partial<typeof requests.$inferInsert> = { status: to, updatedAt: now };
    if (to === "confirmee" && !r.confirmedAt) { patch.confirmedAt = now; patch.confirmationChecks = { ...checks, by: actor.id, at: now.toISOString() }; }
    if (!r.firstContactAt && to !== "nouvelle_demande") patch.firstContactAt = now;
    await tx.update(requests).set(patch).where(eq(requests.id, id));

    if (to === "annulee" || to === "refusee") {
      for (const a of allocs.filter((x) => x.status === "reservee")) {
        await tx.update(allocations).set({ status: "annulee", cancelledAt: now, cancelReason: `Demande ${to}` }).where(eq(allocations.id, a.id));
        await tx.insert(allocationEvents).values({ allocationId: a.id, requestId: id, unitId: a.unitId, kind: "annulation", occurredAt: now, actorId: actor.id, details: { motif: `Demande ${to}`, note } });
      }
    }
    await tx.insert(statusEvents).values({ requestId: id, fromStatus: r.status, toStatus: to, actorId: actor.id, note: note || null });
    return { ok: true, message: "Statut mis à jour." };
  }));
}

export async function addActivity(db: Db, actor: Actor, id: string, kind: "note" | "appel" | "email", body: string): Promise<OpResult> {
  const text = body.trim().slice(0, 4000);
  if (!text) return { ok: false, error: "Note vide." };
  await db.insert(activities).values({ requestId: id, kind, body: text, authorId: actor.id });
  if (kind === "appel") await db.update(requests).set({ firstContactAt: sql`coalesce(${requests.firstContactAt}, now())`, updatedAt: new Date() }).where(eq(requests.id, id));
  return { ok: true, message: "Note enregistrée." };
}

// ───────────────────────── Planning / prolongation ─────────────────────────
export type PlanningInput = {
  confirmedDeliveryAt: Date | null;
  confirmedDeliverySlot: string | null;
  plannedPickupAt: Date | null;
  equipmentModelId: string | null;
  quantityConfirmed?: number | null;
  technicalNote: string | null;
  nextActionAt: Date | null;
  logisticsCostCents: number | null;
  handlingMinutes: number | null;
  distanceKm: number | null;
  incidentCostCents: number | null;
  incidentNote: string | null;
};

/**
 * Enregistre le planning. Une modification de la reprise prévue (prolongation / avancement) est
 * répercutée DANS LA MÊME TRANSACTION sur les affectations ouvertes et tracée de façon immuable.
 * La disponibilité physique ne dépend pas de cette date : un appareil reste bloqué jusqu'à sa reprise constatée.
 */
export async function savePlanning(db: Db, actor: Actor, id: string, p: PlanningInput): Promise<OpResult> {
  if (p.confirmedDeliveryAt && p.plannedPickupAt && p.plannedPickupAt <= p.confirmedDeliveryAt)
    return { ok: false, error: "La reprise prévue doit être postérieure à la livraison." };
  if (p.quantityConfirmed != null && !(Number.isInteger(p.quantityConfirmed) && p.quantityConfirmed > 0 && p.quantityConfirmed <= 500))
    return { ok: false, error: "Quantité confirmée invalide." };
  return guarded(() => db.transaction(async (tx) => {
    const [r] = await tx.select().from(requests).where(eq(requests.id, id)).for("update");
    if (!r) fail("Demande introuvable.");
    const open = await openAllocs(tx, id);
    if (p.quantityConfirmed != null && p.quantityConfirmed < open.length)
      fail(`Quantité confirmée (${p.quantityConfirmed}) inférieure au nombre d'appareils déjà affectés (${open.length}).`);
    if (p.equipmentModelId && open.some((a) => a.status === "reservee") && p.equipmentModelId !== r.equipmentModelId) {
      const units = await tx.select({ modelId: equipmentUnits.modelId }).from(equipmentUnits).where(inArray(equipmentUnits.id, open.map((a) => a.unitId)));
      if (units.some((u) => u.modelId !== p.equipmentModelId)) fail("Des appareils d'un autre modèle sont déjà affectés : annulez ces réservations avant de changer de modèle.");
    }
    const now = new Date();
    await tx.update(requests).set({
      ...p,
      quantityConfirmed: p.quantityConfirmed === undefined ? r.quantityConfirmed : p.quantityConfirmed,
      distanceKm: p.distanceKm == null ? null : String(p.distanceKm),
      updatedAt: now,
    }).where(eq(requests.id, id));

    const pickupChanged = (r.plannedPickupAt?.getTime() ?? null) !== (p.plannedPickupAt?.getTime() ?? null);
    const deliveryChanged = (r.confirmedDeliveryAt?.getTime() ?? null) !== (p.confirmedDeliveryAt?.getTime() ?? null);
    for (const a of open) {
      const patch: Partial<typeof allocations.$inferInsert> = {};
      if (pickupChanged) patch.endAt = p.plannedPickupAt;
      if (deliveryChanged && a.status === "reservee" && p.confirmedDeliveryAt) patch.startAt = p.confirmedDeliveryAt;
      if (Object.keys(patch).length) {
        await tx.update(allocations).set(patch).where(eq(allocations.id, a.id));
      }
    }
    if (pickupChanged && open.length > 0) {
      const kind = r.plannedPickupAt && p.plannedPickupAt && p.plannedPickupAt > r.plannedPickupAt ? "prolongation" : "modification_reprise_prevue";
      for (const a of open) {
        await tx.insert(allocationEvents).values({
          allocationId: a.id, requestId: id, unitId: a.unitId, kind, occurredAt: now, actorId: actor.id,
          details: { avant: r.plannedPickupAt?.toISOString() ?? null, apres: p.plannedPickupAt?.toISOString() ?? null },
        });
      }
      await tx.insert(activities).values({ requestId: id, kind: "note", authorId: actor.id,
        body: `${kind === "prolongation" ? "Prolongation" : "Modification de la reprise prévue"} : ${r.plannedPickupAt?.toISOString() ?? "non fixée"} → ${p.plannedPickupAt?.toISOString() ?? "non fixée"} (${open.length} appareil(s)).` });
    }
    await audit(tx as unknown as Db, actor.id, "request.planning", "request", id);
    return { ok: true, message: "Planning et informations enregistrés." };
  }));
}

// ───────────────────────── Devis ─────────────────────────
export type QuoteLineInput = { label: string; quantity: number; unitHtCents: number };

/** Crée une version de devis IMMUABLE (prix figés). */
export async function createQuote(db: Db, actor: Actor, id: string, lines: QuoteLineInput[], note: string): Promise<OpResult> {
  const clean = lines.filter((l) => l.label.trim() && l.quantity > 0 && Number.isInteger(l.quantity) && l.unitHtCents >= 0 && Number.isInteger(l.unitHtCents));
  if (clean.length === 0) return { ok: false, error: "Le devis doit contenir au moins une ligne valide." };
  const active = await getActiveSettings(db);
  return guarded(() => db.transaction(async (tx) => {
    const [r] = await tx.select({ id: requests.id }).from(requests).where(eq(requests.id, id)).for("update");
    if (!r) fail("Demande introuvable.");
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${quotes.version}), 0)::int` }).from(quotes).where(eq(quotes.requestId, id));
    const fixed = clean.map((l) => ({ label: l.label.trim().slice(0, 200), quantity: l.quantity, unitHtCents: l.unitHtCents, totalHtCents: l.quantity * l.unitHtCents }));
    const totalHt = fixed.reduce((a, l) => a + l.totalHtCents, 0);
    const vat = vatOf(totalHt, active.settings);
    await tx.insert(quotes).values({
      requestId: id, version: Number(max) + 1, lines: fixed, totalHtCents: totalHt,
      vatRateBp: active.settings.vatApplicable ? active.settings.vatRateBp : 0, totalTtcCents: totalHt + vat,
      pricingVersionId: active.id, note: note.trim().slice(0, 1000) || null, createdBy: actor.id,
    });
    await tx.insert(activities).values({ requestId: id, kind: "note", body: `Devis v${Number(max) + 1} créé : ${(totalHt / 100).toFixed(2)} € HT`, authorId: actor.id });
    return { ok: true, message: `Devis v${Number(max) + 1} enregistré.` };
  }));
}

// ───────────────────────── Affectation (P0-3) ─────────────────────────
export function expectedQuantity(r: { quantityConfirmed: number | null; quantityRequested: number | null }) {
  return r.quantityConfirmed ?? r.quantityRequested ?? null;
}

/**
 * Affecte des appareils, en transaction, après contrôle :
 *  - identifiants distincts, appareils actifs, état louable (neuf/bon), bon service ;
 *  - modèle = modèle retenu pour la demande (sauf lot mixte explicitement justifié) ;
 *  - total affecté ≤ quantité confirmée ;
 *  - aucun appareil déjà affecté ailleurs et non restitué (index unique : sûr en concurrence).
 */
export async function allocateUnits(db: Db, actor: Actor, id: string, unitIds: string[], opts: { mixedJustification?: string } = {}): Promise<OpResult> {
  if (unitIds.length === 0) return { ok: false, error: "Sélectionnez au moins un appareil." };
  if (new Set(unitIds).size !== unitIds.length) return { ok: false, error: "Le même appareil a été sélectionné plusieurs fois." };
  return guarded(() => db.transaction(async (tx) => {
    const [r] = await tx.select().from(requests).where(eq(requests.id, id)).for("update");
    if (!r) fail("Demande introuvable.");
    if (!["confirmee", "preparation"].includes(r.status)) fail("Affectation possible uniquement pour une demande confirmée ou en préparation.");
    if (!r.confirmedDeliveryAt) fail("Renseignez d'abord la date de livraison confirmée.");
    if (!r.equipmentModelId) fail("Choisissez d'abord le modèle de matériel retenu (Planning).");
    const expected = expectedQuantity(r);
    if (!expected) fail("Renseignez la quantité confirmée (Planning).");

    const units = await tx.select({ u: equipmentUnits, m: equipmentModels }).from(equipmentUnits)
      .innerJoin(equipmentModels, eq(equipmentUnits.modelId, equipmentModels.id))
      .where(inArray(equipmentUnits.id, unitIds)).for("update", { of: equipmentUnits });
    if (units.length !== unitIds.length) fail("Appareil introuvable.");
    const bad = units.filter(({ u }) => !u.active || !(RENTABLE_CONDITIONS as readonly string[]).includes(u.condition));
    if (bad.length) fail(`Appareil(s) non louable(s) (état ou inactif) : ${bad.map(({ u }) => `${u.inventoryCode} (${u.condition})`).join(", ")}.`);
    const wrongService = units.filter(({ m }) => m.service !== r.service);
    if (wrongService.length) fail(`Appareil(s) d'un autre service : ${wrongService.map(({ u }) => u.inventoryCode).join(", ")}.`);
    const otherModel = units.filter(({ m }) => m.id !== r.equipmentModelId);
    const just = opts.mixedJustification?.trim() ?? "";
    if (otherModel.length && just.length < 10)
      fail(`Modèle différent du modèle retenu pour : ${otherModel.map(({ u }) => u.inventoryCode).join(", ")}. Lot mixte : justification obligatoire (10 caractères min.).`);
    if (r.service === "chauffage") {
      const [chosen] = await tx.select().from(equipmentModels).where(eq(equipmentModels.id, r.equipmentModelId!));
      const diffPower = units.filter(({ m }) => m.electricalPowerW !== chosen?.electricalPowerW);
      if (diffPower.length && just.length < 10) fail(`Puissance différente du modèle retenu : ${diffPower.map(({ u }) => u.inventoryCode).join(", ")}.`);
    }

    const open = await openAllocs(tx, id);
    if (open.some((a) => unitIds.includes(a.unitId))) fail("Un appareil sélectionné est déjà affecté à cette demande.");
    if (open.length + unitIds.length > expected!) fail(`Trop d'appareils : ${open.length} déjà affecté(s) + ${unitIds.length} > quantité confirmée ${expected}.`);

    // Message explicite si un appareil est encore chez un autre client (le contrôle final reste l'index unique).
    const busy = await tx.select({ code: equipmentUnits.inventoryCode, ref: requests.reference, status: allocations.status })
      .from(allocations).innerJoin(equipmentUnits, eq(allocations.unitId, equipmentUnits.id)).innerJoin(requests, eq(allocations.requestId, requests.id))
      .where(and(inArray(allocations.unitId, unitIds), inArray(allocations.status, [...OPEN_ALLOCATION])));
    if (busy.length) fail(`Indisponible tant que la reprise n'est pas constatée : ${busy.map((b) => `${b.code} (${b.status === "remise" ? "chez le client" : "réservé"} — ${b.ref})`).join(", ")}.`);

    const now = new Date();
    for (const { u, m } of units) {
      const [a] = await tx.insert(allocations).values({ requestId: id, unitId: u.id, startAt: r.confirmedDeliveryAt!, endAt: r.plannedPickupAt ?? null, status: "reservee", createdBy: actor.id }).returning({ id: allocations.id });
      await tx.insert(allocationEvents).values({ allocationId: a.id, requestId: id, unitId: u.id, kind: "reservation", occurredAt: now, actorId: actor.id,
        details: { modele: `${m.brand} ${m.model}`, ...(m.id !== r.equipmentModelId ? { lotMixte: just } : {}) } });
    }
    await audit(tx as unknown as Db, actor.id, "request.allocate", "request", id, { units: unitIds.length });
    return { ok: true, message: `${unitIds.length} appareil(s) affecté(s).` };
  }));
}

/** Annule une RÉSERVATION (appareil non remis). Un appareil remis ne se libère que par un constat de reprise. */
export async function cancelReservation(db: Db, actor: Actor, allocationId: string, reason: string): Promise<OpResult> {
  if (actor.role !== "admin") return { ok: false, error: "Seul un administrateur peut annuler une réservation." };
  if (reason.trim().length < 5) return { ok: false, error: "Motif d'annulation obligatoire." };
  return guarded(() => db.transaction(async (tx) => {
    const [a] = await tx.select().from(allocations).where(eq(allocations.id, allocationId)).for("update");
    if (!a) fail("Affectation introuvable.");
    if (a.status !== "reservee") fail(a.status === "remise" ? "Appareil chez le client : enregistrez un constat de reprise." : "Affectation déjà clôturée.");
    const now = new Date();
    await tx.update(allocations).set({ status: "annulee", cancelledAt: now, cancelReason: reason.trim().slice(0, 500) }).where(eq(allocations.id, a.id));
    await tx.insert(allocationEvents).values({ allocationId: a.id, requestId: a.requestId, unitId: a.unitId, kind: "annulation", occurredAt: now, actorId: actor.id, details: { motif: reason.trim() } });
    return { ok: true, message: "Réservation annulée (tracée)." };
  }));
}

// ───────────────────────── Constats (P0-2) ─────────────────────────
export type PhotoInput = { contentType: string; bytes: Buffer };
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const SCAN_TYPES = [...PHOTO_TYPES, "application/pdf"];
export const PHOTO_MAX_BYTES = 1_200_000;
export const SCAN_MAX_BYTES = 2_500_000;
export const PHOTO_MAX_COUNT = 3;
const TOTAL_MAX_BYTES = 3_800_000; // sous la limite de 4 Mo des actions serveur

function signatureOk(p: PhotoInput) {
  const sig = p.bytes.subarray(0, 12).toString("hex");
  if (p.contentType === "application/pdf") return p.bytes.subarray(0, 5).toString() === "%PDF-";
  return sig.startsWith("ffd8ff") || sig.startsWith("89504e47") || (sig.startsWith("52494646") && p.bytes.subarray(8, 12).toString() === "WEBP");
}
function checkPhotos(photos: PhotoInput[], scan?: PhotoInput | null) {
  if (photos.length > PHOTO_MAX_COUNT) fail(`${PHOTO_MAX_COUNT} photos maximum.`);
  for (const p of photos) {
    if (!PHOTO_TYPES.includes(p.contentType)) fail("Photos : formats JPEG, PNG ou WebP uniquement.");
    if (p.bytes.length > PHOTO_MAX_BYTES) fail("Photo trop lourde (1,2 Mo maximum).");
    if (!signatureOk(p)) fail("Fichier photo invalide.");
  }
  if (scan) {
    if (!SCAN_TYPES.includes(scan.contentType)) fail("Scan du bon : PDF, JPEG, PNG ou WebP uniquement.");
    if (scan.bytes.length > SCAN_MAX_BYTES) fail("Scan du bon trop lourd (2,5 Mo maximum).");
    if (!signatureOk(scan)) fail("Fichier de scan invalide.");
  }
  const total = photos.reduce((a, p) => a + p.bytes.length, 0) + (scan?.bytes.length ?? 0);
  if (total > TOTAL_MAX_BYTES) fail("Pièces jointes trop lourdes au total (3,8 Mo maximum).");
}

async function storeAttachment(tx: Tx, handoverId: string, kind: "photo" | "bon_signe", p: PhotoInput, actorId: string) {
  const enc = encryptFile(p.bytes);
  const [row] = await tx.insert(handoverPhotos).values({
    handoverId, kind, contentType: p.contentType, content: enc.content, encryption: enc.encryption,
    sha256: sha256(p.bytes), sizeBytes: p.bytes.length, uploadedBy: actorId,
  }).returning({ id: handoverPhotos.id });
  return row.id;
}

export type Signature = "signe" | "refus" | "non_recueilli";
export const SIGNATURE_LABEL: Record<Signature, string> = {
  signe: "bon signé par le réceptionnaire",
  refus: "le réceptionnaire REFUSE de signer",
  non_recueilli: "signature non recueillie (réceptionnaire absent ou autre)",
};
export const INCIDENT_LABEL: Record<string, string> = {
  notice_non_remise: "Notice du fabricant non remise",
  refus_signature: "Refus de signature du bon",
  signature_non_recueillie: "Signature non recueillie",
  autre: "Autre incident",
};

/** Incidents imposés par les faits saisis. Chacun exige un motif et des consignes de résolution. */
async function openIncidents(tx: Tx, actor: Actor, requestId: string, handoverId: string, kinds: string[], description: string, instructions: string) {
  for (const kind of kinds) {
    await tx.insert(incidents).values({ requestId, handoverId, kind, description: description.trim().slice(0, 2000), resolutionInstructions: instructions.trim().slice(0, 2000), reportedBy: actor.id });
    await tx.insert(activities).values({ requestId, kind: "note", authorId: actor.id, body: `INCIDENT ouvert — ${INCIDENT_LABEL[kind]} : ${description.trim()}` });
  }
}

async function latestBonId(tx: Tx, requestId: string) {
  const [d] = await tx.select({ id: documents.id }).from(documents).where(eq(documents.requestId, requestId)).orderBy(sql`${documents.version} desc`).limit(1);
  return d?.id ?? null;
}

export type DeliveryInput = {
  occurredAt: Date;
  agentName: string;
  recipientName: string;
  allocationIds: string[];
  /** Notice remise PAR MODÈLE effectivement livré : { [modelId]: true|false }. */
  notices: Record<string, boolean>;
  signature: Signature;
  reserves: string;
  quantityJustification: string;
  /** Obligatoires si un incident est ouvert (notice non remise, refus / absence de signature). */
  incidentDescription: string;
  incidentInstructions: string;
  photos: PhotoInput[];
  signedScan?: PhotoInput | null;
};

/**
 * Constat de REMISE : date/heure réelles, appareils effectivement remis, notice par modèle, signature.
 * Issue qualifiée : « conforme » seulement si bon signé ET toutes les notices remises (contrainte en base) ;
 * sinon INCIDENT obligatoire (motif + consignes), visible au tableau de bord jusqu'à résolution.
 */
export async function recordDelivery(db: Db, actor: Actor, requestId: string, i: DeliveryInput): Promise<OpResult> {
  return guarded(() => db.transaction(async (tx) => {
    checkPhotos(i.photos, i.signedScan);
    const [r] = await tx.select().from(requests).where(eq(requests.id, requestId)).for("update");
    if (!r) fail("Demande introuvable.");
    if (!["confirmee", "preparation", "livree", "reprise_planifiee"].includes(r.status)) fail("Constat de remise impossible pour ce statut.");
    if (!i.agentName.trim() || !i.recipientName.trim()) fail("Nom de la personne qui remet et du réceptionnaire obligatoires.");
    if (i.occurredAt.getTime() > Date.now() + LATE_TOLERANCE_MS) fail("La date de remise réelle ne peut pas être dans le futur.");
    if (i.allocationIds.length === 0) fail("Cochez les appareils effectivement remis.");
    if (new Set(i.allocationIds).size !== i.allocationIds.length) fail("Appareil coché deux fois.");
    if (!["signe", "refus", "non_recueilli"].includes(i.signature)) fail("Indiquez l'état de la signature du bon.");
    const rows = await tx.select({ a: allocations, u: equipmentUnits, m: equipmentModels }).from(allocations)
      .innerJoin(equipmentUnits, eq(allocations.unitId, equipmentUnits.id)).innerJoin(equipmentModels, eq(equipmentUnits.modelId, equipmentModels.id))
      .where(and(eq(allocations.requestId, requestId), inArray(allocations.id, i.allocationIds))).for("update", { of: allocations });
    if (rows.length !== i.allocationIds.length || rows.some(({ a }) => a.status !== "reservee")) fail("Seuls des appareils réservés pour cette demande et non encore remis peuvent être remis.");
    const delivered = (await tx.select({ n: sql<number>`count(*)::int` }).from(allocations).where(and(eq(allocations.requestId, requestId), inArray(allocations.status, ["remise", "retournee"]))))[0].n;
    const expected = expectedQuantity(r);
    const totalAfter = Number(delivered) + rows.length;
    if (expected != null && totalAfter !== expected && i.quantityJustification.trim().length < 10)
      fail(`Quantité remise (${totalAfter} au total) différente de la quantité confirmée (${expected}) : justification obligatoire (10 caractères min.).`);

    // Notice par modèle livré
    const models = new Map(rows.map(({ m }) => [m.id, `${m.brand} ${m.model}${m.manufacturerRef ? ` (${m.manufacturerRef})` : ""}`]));
    const notices: Record<string, { label: string; given: boolean }> = {};
    for (const [id, label] of models) {
      if (typeof i.notices[id] !== "boolean") fail(`Indiquez si la notice du modèle ${label} a été remise.`);
      notices[id] = { label, given: i.notices[id] };
    }
    const noticeGiven = Object.values(notices).every((n) => n.given);
    const kinds = [
      ...(noticeGiven ? [] : ["notice_non_remise"]),
      ...(i.signature === "refus" ? ["refus_signature"] : i.signature === "non_recueilli" ? ["signature_non_recueillie"] : []),
    ];
    if (kinds.length && (i.incidentDescription.trim().length < 10 || i.incidentInstructions.trim().length < 10))
      fail("Incident : décrivez ce qui s'est passé (qui, pourquoi) et les consignes de résolution (10 caractères min. chacun).");
    const outcome = kinds.length ? "incident" : i.reserves.trim() ? "avec_reserves" : "conforme";

    const [h] = await tx.insert(handovers).values({
      requestId, kind: "remise", occurredAt: i.occurredAt, agentName: i.agentName.trim().slice(0, 120), recipientName: i.recipientName.trim().slice(0, 120),
      quantity: rows.length, quantityExpected: expected, quantityJustification: i.quantityJustification.trim().slice(0, 1000) || null,
      noticeGiven, notices, signature: i.signature, outcome, reserves: i.reserves.trim().slice(0, 2000) || null, paperSigned: i.signature === "signe",
      bonDocumentId: await latestBonId(tx, requestId), recordedBy: actor.id,
    }).returning({ id: handovers.id });
    for (const { a, u } of rows) {
      await tx.update(allocations).set({ status: "remise", deliveredAt: i.occurredAt, deliveryHandoverId: h.id }).where(eq(allocations.id, a.id));
      await tx.insert(handoverItems).values({ handoverId: h.id, allocationId: a.id, unitId: u.id, inventoryCode: u.inventoryCode, condition: u.condition });
      await tx.insert(allocationEvents).values({ allocationId: a.id, requestId, unitId: u.id, kind: "remise", occurredAt: i.occurredAt, actorId: actor.id, details: { constat: h.id, issue: outcome } });
    }
    for (const p of i.photos) await storeAttachment(tx, h.id, "photo", p, actor.id);
    if (i.signedScan) await storeAttachment(tx, h.id, "bon_signe", i.signedScan, actor.id);
    if (kinds.length) await openIncidents(tx, actor, requestId, h.id, kinds, i.incidentDescription, i.incidentInstructions);

    if (["confirmee", "preparation"].includes(r.status)) {
      await tx.update(requests).set({ status: "livree", deliveredAt: r.deliveredAt ?? i.occurredAt, updatedAt: new Date() }).where(eq(requests.id, requestId));
      await tx.insert(statusEvents).values({ requestId, fromStatus: r.status, toStatus: "livree", actorId: actor.id,
        note: `Constat de remise (${outcome === "conforme" ? "conforme" : outcome === "avec_reserves" ? "avec réserves" : "AVEC INCIDENT"}) : ${totalAfter}/${expected ?? "?"} appareil(s) remis` });
    }
    const label = outcome === "conforme" ? "conforme" : outcome === "avec_reserves" ? "avec réserves" : "avec INCIDENT ouvert";
    return { ok: true, message: `Constat de remise enregistré (${rows.length} appareil(s)) — remise ${label}.${!i.signedScan ? " Pensez à déposer le scan du bon signé." : ""}`, id: h.id };
  }));
}

export type ReturnItemInput = { allocationId: string; condition: "conforme" | "degrade" | "incomplet" | "hors_service"; note: string };
export type ReturnInput = {
  occurredAt: Date;
  agentName: string;
  recipientName: string;
  items: ReturnItemInput[];
  generalCondition: "conforme" | "degrade" | "incomplet";
  reserves: string;
  signature: Signature;
  incidentDescription: string;
  incidentInstructions: string;
  photos: PhotoInput[];
  signedScan?: PhotoInput | null;
};

/**
 * P0-A : un appareil repris n'est JAMAIS directement louable, même d'apparence conforme.
 * Il passe « à contrôler » jusqu'au contrôle technique (recordInspection) ; hors service reste hors service.
 */
const CONDITION_AFTER_RETURN = { conforme: "a_controler", degrade: "a_controler", incomplet: "a_controler", hors_service: "hors_service" } as const;

/**
 * Constat de REPRISE (totale ou partielle). Seuls les appareils constatés sont restitués et redeviennent
 * disponibles (et uniquement s'ils sont conformes) ; les autres restent bloqués chez le client.
 */
export async function recordReturn(db: Db, actor: Actor, requestId: string, i: ReturnInput): Promise<OpResult> {
  return guarded(() => db.transaction(async (tx) => {
    checkPhotos(i.photos, i.signedScan);
    if (!["signe", "refus", "non_recueilli"].includes(i.signature)) fail("Indiquez l'état de la signature de la partie reprise.");
    const sigKinds = i.signature === "refus" ? ["refus_signature"] : i.signature === "non_recueilli" ? ["signature_non_recueillie"] : [];
    if (sigKinds.length && (i.incidentDescription.trim().length < 10 || i.incidentInstructions.trim().length < 10))
      fail("Incident : décrivez ce qui s'est passé et les consignes de résolution (10 caractères min. chacun).");
    const [r] = await tx.select().from(requests).where(eq(requests.id, requestId)).for("update");
    if (!r) fail("Demande introuvable.");
    if (!i.agentName.trim() || !i.recipientName.trim()) fail("Nom de la personne qui reprend et du réceptionnaire obligatoires.");
    if (i.occurredAt.getTime() > Date.now() + LATE_TOLERANCE_MS) fail("La date de reprise réelle ne peut pas être dans le futur.");
    if (i.items.length === 0) fail("Cochez les appareils réellement récupérés.");
    const ids = i.items.map((x) => x.allocationId);
    if (new Set(ids).size !== ids.length) fail("Appareil coché deux fois.");
    const rows = await tx.select({ a: allocations, u: equipmentUnits }).from(allocations).innerJoin(equipmentUnits, eq(allocations.unitId, equipmentUnits.id))
      .where(and(eq(allocations.requestId, requestId), inArray(allocations.id, ids))).for("update", { of: allocations });
    if (rows.length !== ids.length || rows.some(({ a }) => a.status !== "remise")) fail("Seuls des appareils remis pour cette demande et non encore repris peuvent être repris.");
    for (const { a, u } of rows) if (!(i.occurredAt > a.deliveredAt!)) fail(`La reprise de ${u.inventoryCode} doit être postérieure à sa remise.`);

    const now = new Date();
    const anyIssue = i.items.some((x) => x.condition !== "conforme") || i.generalCondition !== "conforme" || !!i.reserves.trim();
    const outcome = sigKinds.length ? "incident" : anyIssue ? "avec_reserves" : "conforme";
    const [h] = await tx.insert(handovers).values({
      requestId, kind: "reprise", occurredAt: i.occurredAt, agentName: i.agentName.trim().slice(0, 120), recipientName: i.recipientName.trim().slice(0, 120),
      quantity: rows.length, generalCondition: i.generalCondition, reserves: i.reserves.trim().slice(0, 2000) || null,
      signature: i.signature, outcome, paperSigned: i.signature === "signe",
      bonDocumentId: await latestBonId(tx, requestId), recordedBy: actor.id,
    }).returning({ id: handovers.id });
    for (const { a, u } of rows) {
      const item = i.items.find((x) => x.allocationId === a.id)!;
      await tx.update(allocations).set({ status: "retournee", returnedAt: i.occurredAt, returnVerifiedAt: now, returnCondition: item.condition, returnHandoverId: h.id }).where(eq(allocations.id, a.id));
      await tx.update(equipmentUnits).set({ condition: CONDITION_AFTER_RETURN[item.condition], conditionCheckedAt: now }).where(eq(equipmentUnits.id, u.id));
      await tx.insert(handoverItems).values({ handoverId: h.id, allocationId: a.id, unitId: u.id, inventoryCode: u.inventoryCode, condition: item.condition, note: item.note.trim().slice(0, 500) || null });
      await tx.insert(allocationEvents).values({ allocationId: a.id, requestId, unitId: u.id, kind: "reprise", occurredAt: i.occurredAt, actorId: actor.id, details: { constat: h.id, etat: item.condition } });
      if (item.condition !== "conforme")
        await tx.insert(activities).values({ requestId, kind: "note", authorId: actor.id, body: `Reprise ${u.inventoryCode} : état apparent « ${item.condition} »${item.note ? ` — ${item.note}` : ""}.` });
    }
    for (const p of i.photos) await storeAttachment(tx, h.id, "photo", p, actor.id);
    if (i.signedScan) await storeAttachment(tx, h.id, "bon_signe", i.signedScan, actor.id);
    if (sigKinds.length) await openIncidents(tx, actor, requestId, h.id, sigKinds, i.incidentDescription, i.incidentInstructions);

    const stillOut = await tx.select({ n: sql<number>`count(*)::int` }).from(allocations).where(and(eq(allocations.requestId, requestId), eq(allocations.status, "remise")));
    const remaining = Number(stillOut[0].n);
    if (remaining === 0 && ["livree", "reprise_planifiee"].includes(r.status)) {
      await tx.update(requests).set({ status: "reprise_effective", returnedAt: i.occurredAt, updatedAt: now }).where(eq(requests.id, requestId));
      await tx.insert(statusEvents).values({ requestId, fromStatus: r.status, toStatus: "reprise_effective", actorId: actor.id, note: `Constat de reprise : dernier(s) appareil(s) récupéré(s)` });
    } else if (remaining > 0) {
      await tx.insert(activities).values({ requestId, kind: "note", authorId: actor.id, body: `Reprise PARTIELLE : ${rows.length} récupéré(s), ${remaining} encore chez le client.` });
    }
    const ctrl = ` ${rows.length} appareil(s) en attente de contrôle technique avant toute nouvelle location.`;
    return { ok: true, message: (remaining > 0 ? `Reprise partielle enregistrée : ${remaining} appareil(s) encore chez le client.` : "Reprise complète enregistrée.") + ctrl, id: h.id };
  }));
}

// ───────────────────────── Scan du bon signé déposé après coup ─────────────────────────
export async function attachSignedBon(db: Db, actor: Actor, handoverId: string, scan: PhotoInput): Promise<OpResult> {
  return guarded(() => db.transaction(async (tx) => {
    checkPhotos([], scan);
    const [h] = await tx.select().from(handovers).where(eq(handovers.id, handoverId));
    if (!h) fail("Constat introuvable.");
    const id = await storeAttachment(tx, h.id, "bon_signe", scan, actor.id);
    await tx.insert(activities).values({ requestId: h.requestId, kind: "note", authorId: actor.id, body: `Scan du bon signé déposé pour le constat de ${h.kind} du ${h.occurredAt.toISOString()}.` });
    await audit(tx as unknown as Db, actor.id, "handover.scan_upload", "handover", h.id, { attachment: id });
    return { ok: true, message: "Scan du bon signé enregistré (accès réservé).", id: h.requestId };
  }));
}

// ───────────────────────── Incidents ─────────────────────────
export async function resolveIncident(db: Db, actor: Actor, incidentId: string, note: string): Promise<OpResult> {
  if (actor.role !== "admin") return { ok: false, error: "Seul un administrateur peut clôturer un incident." };
  if (note.trim().length < 5) return { ok: false, error: "Décrivez la résolution (5 caractères min.)." };
  return guarded(() => db.transaction(async (tx) => {
    const [inc] = await tx.select().from(incidents).where(eq(incidents.id, incidentId)).for("update");
    if (!inc) fail("Incident introuvable.");
    if (inc.status !== "ouvert") fail("Incident déjà résolu.");
    await tx.update(incidents).set({ status: "resolu", resolvedAt: new Date(), resolvedBy: actor.id, resolutionNote: note.trim().slice(0, 2000) }).where(eq(incidents.id, incidentId));
    await tx.insert(activities).values({ requestId: inc.requestId, kind: "note", authorId: actor.id, body: `Incident résolu — ${INCIDENT_LABEL[inc.kind]} : ${note.trim()}` });
    return { ok: true, message: "Incident résolu (tracé).", id: inc.requestId };
  }));
}

// ───────────────────────── Contrôle technique (P0-A) ─────────────────────────
export const INSPECTION_CHECKS = [
  { key: "cordon_fiche", label: "Cordon et fiche intacts (ni écrasement, ni coupure, ni échauffement)" },
  { key: "boitier_stabilite", label: "Boîtier sans fuite ni déformation ; roulettes / pieds et stabilité corrects" },
  { key: "commandes_protections", label: "Thermostat, interrupteurs et dispositifs de sécurité fonctionnels" },
  { key: "essai_fonctionnement", label: "Essai de mise en chauffe concluant, sans odeur ni bruit anormal" },
  { key: "proprete_notice", label: "Appareil nettoyé ; étiquette signalétique lisible ; notice disponible" },
] as const;

export type InspectionInput = {
  inspectedAt: Date;
  inspectorName: string;
  checks: Record<string, boolean>;
  anomalies: string;
  decision: "neuf" | "bon" | "hors_service";
};

/**
 * Enregistre un contrôle technique et applique la décision. Seule voie pour rendre un appareil louable :
 * un déclencheur PostgreSQL refuse tout passage à neuf/bon sans inspection enregistrée dans la même transaction.
 */
export async function recordInspection(db: Db, actor: Actor, unitId: string, i: InspectionInput): Promise<OpResult> {
  if (!["admin", "preparateur", "exploitant"].includes(actor.role)) return { ok: false, error: "Rôle non habilité au contrôle technique." };
  return guarded(() => db.transaction(async (tx) => {
    const [u] = await tx.select().from(equipmentUnits).where(eq(equipmentUnits.id, unitId)).for("update");
    if (!u) fail("Appareil introuvable.");
    if (!["a_controler", "hors_service"].includes(u.condition)) fail(`Appareil ${u.inventoryCode} déjà louable (${u.condition}) : rien à contrôler.`);
    const [open] = await tx.select({ id: allocations.id }).from(allocations).where(and(eq(allocations.unitId, unitId), inArray(allocations.status, [...OPEN_ALLOCATION])));
    if (open) fail("Appareil encore affecté ou chez un client : contrôle impossible.");
    if (!i.inspectorName.trim()) fail("Nom du contrôleur obligatoire.");
    if (i.inspectedAt.getTime() > Date.now() + LATE_TOLERANCE_MS) fail("La date du contrôle ne peut pas être dans le futur.");
    const allOk = INSPECTION_CHECKS.every((c) => i.checks[c.key] === true);
    if (i.decision !== "hors_service" && !allOk) fail("Tous les points de contrôle doivent être validés pour rendre l'appareil louable ; sinon décision « hors service ».");
    if (i.decision === "hors_service" && i.anomalies.trim().length < 5) fail("Décrivez les anomalies justifiant la mise hors service.");
    const [lastRet] = await tx.select().from(allocations).where(and(eq(allocations.unitId, unitId), eq(allocations.status, "retournee"))).orderBy(sql`${allocations.returnedAt} desc`).limit(1);
    if (i.decision === "neuf" && lastRet) fail("Un appareil déjà loué ne peut pas être déclaré « neuf ».");
    if (lastRet && i.inspectedAt < lastRet.returnedAt!) fail("Le contrôle doit être postérieur à la reprise de l'appareil.");

    const [ins] = await tx.insert(unitInspections).values({
      unitId, allocationId: lastRet?.id ?? null, inspectedAt: i.inspectedAt, inspectorName: i.inspectorName.trim().slice(0, 120),
      checks: Object.fromEntries(INSPECTION_CHECKS.map((c) => [c.key, i.checks[c.key] === true])),
      anomalies: i.anomalies.trim().slice(0, 2000) || null, conditionBefore: u.condition, decision: i.decision, recordedBy: actor.id,
    }).returning({ id: unitInspections.id });
    await tx.update(equipmentUnits).set({ condition: i.decision, conditionCheckedAt: i.inspectedAt }).where(eq(equipmentUnits.id, unitId));
    if (lastRet) {
      await tx.insert(allocationEvents).values({ allocationId: lastRet.id, requestId: lastRet.requestId, unitId, kind: "controle", occurredAt: i.inspectedAt, actorId: actor.id,
        details: { inspection: ins.id, decision: i.decision, controleur: i.inspectorName.trim() } });
    }
    await audit(tx as unknown as Db, actor.id, "unit.inspection", "equipment_unit", unitId, { decision: i.decision });
    return { ok: true, message: `Contrôle enregistré : ${u.inventoryCode} → ${i.decision === "hors_service" ? "hors service" : `${i.decision} (louable)`}.` };
  }));
}
