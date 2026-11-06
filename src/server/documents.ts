import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { desc, eq, inArray, and } from "drizzle-orm";
import type { Db } from "@/db/client";
import { allocations, documents, equipmentModels, equipmentUnits } from "@/db/schema";
import { BonDocument, type BonData } from "@/pdf/BonDocument";
import { CLIENT_KIND_LABEL, PLACE_LABEL } from "@/lib/validation/request";
import { formatDateTime, yearInParis } from "@/lib/format";
import { getRequestDetail, audit } from "./admin-data";
import { formatReference, nextCounter } from "./preorders";
import { expectedQuantity, RENTABLE_CONDITIONS } from "./request-ops";
import { env } from "./env";
import { sha256 } from "./security";

export const BON_ALLOWED_STATUSES = ["confirmee", "preparation", "livree", "reprise_planifiee", "reprise_effective", "cloturee"];

export async function buildBonData(db: Db, requestId: string, number: string, version: number, quantityJustification: string | null = null): Promise<BonData> {
  const det = await getRequestDetail(db, requestId);
  if (!det) throw new Error("Demande introuvable");
  const { r, c, d } = det;
  const e = env();
  const activeAllocs = await db.select({ u: equipmentUnits, m: equipmentModels })
    .from(allocations).innerJoin(equipmentUnits, eq(allocations.unitId, equipmentUnits.id)).innerJoin(equipmentModels, eq(equipmentUnits.modelId, equipmentModels.id))
    .where(and(eq(allocations.requestId, requestId), inArray(allocations.status, ["reservee", "remise"])))
    .orderBy(equipmentUnits.inventoryCode);
  // Une ligne par modèle réellement affecté (lots mixtes = bon multi-lignes)
  const byModel = new Map<string, { m: typeof equipmentModels.$inferSelect; codes: string[] }>();
  for (const a of activeAllocs) {
    const g = byModel.get(a.m.id) ?? { m: a.m, codes: [] };
    g.codes.push(a.u.inventoryCode);
    byModel.set(a.m.id, g);
  }
  const powerLabel = (m: typeof equipmentModels.$inferSelect) => (m.electricalPowerW ? `${groupDigits(m.electricalPowerW)} W` : m.coolingPowerW ? `${groupDigits(m.coolingPowerW)} W froid` : null);
  const isPro = c.kind !== "particulier";
  const addr = (l1: string | null, l2: string | null, pc: string | null, city: string | null) => (l1 ? [l1, l2, [pc, city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null);
  return {
    brand: e.BRAND_NAME,
    legal: { companyName: e.LEGAL_COMPANY_NAME ?? null, form: e.LEGAL_FORM ?? null, siren: e.LEGAL_SIREN ?? null, address: e.LEGAL_ADDRESS ?? null, email: e.LEGAL_EMAIL ?? null, phone: e.LEGAL_PHONE ?? null },
    number,
    version,
    requestReference: r.reference,
    generatedAt: formatDateTime(new Date()),
    customer: {
      kindLabel: CLIENT_KIND_LABEL[c.kind],
      isPro,
      companyName: isPro ? c.companyName : null,
      siret: isPro ? c.siret : null,
      contactName: c.contactName,
      phone: c.phone,
      email: c.email,
      address: addr(c.billingLine1, c.billingLine2, c.billingPostalCode, c.billingCity),
      customerReference: r.customerReference,
    },
    delivery: {
      recipientName: d.recipientName,
      recipientPhone: d.recipientPhone,
      address: addr(d.line1, d.line2, d.postalCode, d.city)!,
      floor: d.floor ? `étage ${d.floor}` : null,
      elevator: d.elevator && d.elevator !== "inconnu" ? d.elevator : null,
      access: [d.accessInstructions, d.parking].filter(Boolean).join(" · ") || null,
      placeLabel: PLACE_LABEL[d.placeType as keyof typeof PLACE_LABEL] ?? d.placeType,
    },
    plannedDelivery: r.confirmedDeliveryAt ? `${formatDateTime(r.confirmedDeliveryAt)}${r.confirmedDeliverySlot ? ` (${r.confirmedDeliverySlot})` : ""}` : null,
    plannedPickup: r.plannedPickupAt ? formatDateTime(r.plannedPickupAt) : null,
    service: r.service,
    equipmentLines: [...byModel.values()].map(({ m, codes }) => ({
      brand: m.brand, model: m.model, manufacturerRef: m.manufacturerRef, powerLabel: powerLabel(m), noticeVersion: m.noticeVersion, quantity: codes.length, codes,
    })),
    quantityPlanned: activeAllocs.length,
    quantityOrdered: expectedQuantity(r),
    quantityJustification,
    units: activeAllocs.map((a) => ({ code: a.u.inventoryCode, serial: a.u.serialNumber, lot: a.u.lotNumber, condition: a.u.condition, model: `${a.m.brand} ${a.m.model}` })),
    allNewVerified: activeAllocs.length > 0 && activeAllocs.every((a) => a.u.condition === "neuf" && !!a.u.conditionCheckedAt),
    isErp: r.isErp,
  };
}

export async function renderBonPdf(data: BonData): Promise<Buffer> {
  return renderToBuffer(React.createElement(BonDocument, { data }) as Parameters<typeof renderToBuffer>[0]);
}

/**
 * Génère et ARCHIVE une nouvelle version du bon (immuable). Le numéro BR reste stable pour une demande.
 * Refuse un bon trompeur : aucun appareil affecté, appareil devenu non louable, ou quantité différente
 * de la quantité confirmée sans justification explicite (imprimée sur le bon).
 */
export async function generateBon(db: Db, requestId: string, actorId: string, quantityJustification = "") {
  const det = await getRequestDetail(db, requestId);
  if (!det) return { ok: false as const, error: "Demande introuvable." };
  if (!BON_ALLOWED_STATUSES.includes(det.r.status)) return { ok: false as const, error: "Le bon ne peut être généré qu'à partir d'une demande confirmée." };
  const open = det.allocs.filter(({ a }) => a.status === "reservee" || a.status === "remise");
  if (open.length === 0) return { ok: false as const, error: "Aucun appareil affecté : affectez les appareils avant de générer le bon." };
  const notRentable = open.filter(({ a, u }) => a.status === "reservee" && !(RENTABLE_CONDITIONS as readonly string[]).includes(u.condition));
  if (notRentable.length) return { ok: false as const, error: `Appareil(s) devenu(s) non louable(s) : ${notRentable.map(({ u }) => u.inventoryCode).join(", ")}. Annulez la réservation et remplacez-les.` };
  const expected = expectedQuantity(det.r);
  const just = quantityJustification.trim();
  if (expected != null && open.length !== expected && just.length < 10)
    return { ok: false as const, error: `${open.length} appareil(s) affecté(s) pour ${expected} confirmé(s) : justification de l'écart obligatoire (10 caractères min.), elle sera imprimée sur le bon.` };
  const [last] = await db.select().from(documents).where(and(eq(documents.requestId, requestId), eq(documents.kind, "bon_remise_reprise"))).orderBy(desc(documents.version)).limit(1);
  const number = last?.number ?? formatReference("BR", yearInParis(), await nextCounter(db, `bon-${yearInParis()}`));
  const version = (last?.version ?? 0) + 1;
  const data = await buildBonData(db, requestId, number, version, expected != null && open.length !== expected ? just.slice(0, 300) : null);
  const pdf = await renderBonPdf(data);
  const [doc] = await db.insert(documents).values({
    requestId, kind: "bon_remise_reprise", number, version, content: pdf, sha256: sha256(pdf), snapshot: data, generatedBy: actorId,
  }).returning({ id: documents.id });
  await audit(db, actorId, "document.generate", "document", doc.id, { number, version });
  return { ok: true as const, id: doc.id, number, version, bytes: pdf.length };
}

/** Séparateur de milliers compatible avec la police PDF standard (espace insécable U+00A0, présent en WinAnsi). */
function groupDigits(n: number) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
}
