import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customers, deliverySites, notifications, requests, statusEvents, analyticsEvents } from "@/db/schema";
import { estimateHeating } from "@/lib/domain/heating";
import { estimateCooling } from "@/lib/domain/cooling";
import { estimatePrice, type PriceEstimate } from "@/lib/domain/pricing";
import type { BusinessSettings } from "@/lib/domain/settings";
import type { RequestPayload } from "@/lib/validation/request";
import { yearInParis } from "@/lib/format";
import { getActiveSettings } from "./settings-store";
import { clientAckEmail, teamAlertEmail, type EmailSummary } from "./email-templates";
import { env } from "./env";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function nextCounter(tx: Tx | Db, scope: string): Promise<number> {
  const rows = await tx.execute<{ value: number }>(sql`
    INSERT INTO counters (scope, value) VALUES (${scope}, 1)
    ON CONFLICT (scope) DO UPDATE SET value = counters.value + 1
    RETURNING value`);
  return Number(rows[0].value);
}

export function formatReference(prefix: string, year: number, n: number) {
  return `${prefix}-${year}-${String(n).padStart(6, "0")}`;
}

/** Calcul complet côté serveur (besoin + prix), à partir des seules entrées client. */
export function computeNeedAndPrice(p: Pick<RequestPayload, "service" | "heating" | "cooling" | "site" | "schedule" | "delivery">, settings: BusinessSettings) {
  let heating = null as ReturnType<typeof estimateHeating> | null;
  let cooling = null as ReturnType<typeof estimateCooling> | null;
  let quantity = 1;
  if (p.service === "chauffage" && p.heating) {
    heating = estimateHeating(
      {
        roomSurfaces: p.heating.surfaceMode === "detail" ? p.heating.roomSurfaces : undefined,
        totalSurfaceM2: p.heating.totalSurfaceM2,
        rooms: p.heating.rooms,
        ceilingHeightM: p.heating.ceilingHeightM,
        insulation: p.heating.insulation,
        placeType: p.site.placeType,
      },
      settings,
    );
    quantity = Math.min(p.heating.quantityRequested, settings.heating.sizing.maxSelectableUnits);
  } else if (p.service === "climatisation" && p.cooling) {
    cooling = estimateCooling(p.cooling, settings);
  }
  const dwelling = p.site.placeType === "appartement" || p.site.placeType === "maison";
  const manual =
    (heating?.requiresManualReview ?? false) ||
    (dwelling && quantity > settings.heating.sizing.maxUnitsPerDwellingAuto);
  const price: PriceEstimate = estimatePrice(
    {
      service: p.service,
      quantity,
      estimatedDays: p.schedule.durationUnknown ? null : (p.schedule.estimatedDays ?? null),
      postalCode: p.delivery.address.postalCode,
      expressRequested: p.schedule.expressRequested,
      multiSite: p.site.multiSite,
      placeType: p.site.placeType,
      manualReview: manual,
    },
    settings,
  );
  return { heating, cooling, quantity, price, requiresManualReview: manual || p.site.placeType === "erp_ecole" || p.service === "climatisation" };
}

export type CreatePreorderResult = { id: string; reference: string; duplicate: boolean; quoteMode: "estimate" | "sur_devis" };

/**
 * Enregistre une précommande dans UNE transaction : client, lieu, demande, historique,
 * notifications (outbox). Aucune réponse positive n'est renvoyée avant le COMMIT.
 */
export async function createPreorder(db: Db, p: RequestPayload): Promise<CreatePreorderResult> {
  const existing = await db.select({ id: requests.id, reference: requests.reference, quoteMode: requests.quoteMode })
    .from(requests).where(eq(requests.idempotencyKey, p.idempotencyKey)).limit(1);
  if (existing[0]) return { ...existing[0], quoteMode: existing[0].quoteMode as "estimate" | "sur_devis", duplicate: true };

  const active = await getActiveSettings(db);
  const s = active.settings;
  const calc = computeNeedAndPrice(p, s);
  const e = env();
  const pro = p.customer.kind !== "particulier";
  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      const year = yearInParis(now);
      const n = await nextCounter(tx, `request-${year}`);
      const reference = formatReference("RC", year, n);

      const [cust] = await tx.insert(customers).values({
        kind: p.customer.kind,
        companyName: pro ? p.customer.companyName ?? null : null,
        siret: pro && p.customer.siret ? p.customer.siret.replace(/\s/g, "") : null,
        contactName: p.customer.contactName,
        phone: p.customer.phone,
        email: p.customer.email.toLowerCase(),
        billingLine1: p.customer.billingAddress?.line1 ?? null,
        billingLine2: p.customer.billingAddress?.line2 ?? null,
        billingPostalCode: p.customer.billingAddress?.postalCode ?? null,
        billingCity: p.customer.billingAddress?.city ?? null,
      }).returning({ id: customers.id });

      const [site] = await tx.insert(deliverySites).values({
        recipientName: p.delivery.recipientName,
        recipientPhone: p.delivery.recipientPhone,
        line1: p.delivery.address.line1,
        line2: p.delivery.address.line2 ?? null,
        postalCode: p.delivery.address.postalCode,
        city: p.delivery.address.city,
        floor: p.site.floor ?? null,
        elevator: p.site.elevator,
        parking: p.site.parking ?? null,
        accessInstructions: p.delivery.accessInstructions ?? null,
        preferredHours: p.delivery.preferredHours ?? null,
        placeType: p.site.placeType,
      }).returning({ id: deliverySites.id });

      const surface = p.service === "chauffage"
        ? (p.heating!.surfaceMode === "detail" ? p.heating!.roomSurfaces!.reduce((a, x) => a + x, 0) : p.heating!.totalSurfaceM2!)
        : p.cooling!.surfaceM2;
      const rooms = p.service === "chauffage"
        ? (p.heating!.surfaceMode === "detail" ? p.heating!.roomSurfaces!.length : p.heating!.rooms!)
        : p.cooling!.rooms;

      const est = calc.price;
      const [r] = await tx.insert(requests).values({
        reference,
        service: p.service,
        status: "nouvelle_demande",
        customerId: cust.id,
        deliverySiteId: site.id,
        placeType: p.site.placeType,
        isErp: p.site.placeType === "erp_ecole",
        multiSite: p.site.multiSite,
        siteCount: p.site.multiSite ? p.site.siteCount ?? null : null,
        multiSiteDetails: p.site.multiSite ? p.site.multiSiteDetails ?? null : null,
        needInput: { heating: p.heating ?? null, cooling: p.cooling ?? null, site: p.site },
        surfaceM2: String(surface),
        rooms,
        ceilingHeightM: String(p.service === "chauffage" ? p.heating!.ceilingHeightM : p.cooling!.ceilingHeightM),
        insulation: p.service === "chauffage" ? p.heating!.insulation : p.cooling!.insulation,
        quantityRecommended: calc.heating?.recommendedUnits ?? null,
        quantityRequested: p.service === "chauffage" ? calc.quantity : null,
        estimatedPowerW: calc.heating ? calc.quantity * s.heating.sizing.unitPowerW : null,
        requiresManualReview: calc.requiresManualReview,
        desiredStartDate: p.schedule.desiredStartDate,
        estimatedDays: p.schedule.durationUnknown ? null : p.schedule.estimatedDays ?? null,
        durationUnknown: p.schedule.durationUnknown,
        plannedReturnDate: p.schedule.plannedReturnDate ?? null,
        expressRequested: p.schedule.expressRequested,
        customerReference: p.customer.customerReference ?? null,
        notes: p.notes ?? null,
        pricingVersionId: active.id,
        estimateSnapshot: {
          pricingVersion: active.version,
          computedAt: now.toISOString(),
          price: est,
          heating: calc.heating,
          cooling: calc.cooling,
        },
        quoteMode: est.mode,
        estimatedTotalHtCents: est.mode === "estimate" ? est.totalHtCents : null,
        estimatedTotalTtcCents: est.mode === "estimate" ? est.totalTtcCents : null,
        termsVersion: s.legal.termsVersion,
        privacyVersion: s.legal.privacyVersion,
        consentAt: now,
        idempotencyKey: p.idempotencyKey,
        attribution: p.attribution ?? null,
      }).returning({ id: requests.id });

      await tx.insert(statusEvents).values({ requestId: r.id, fromStatus: null, toStatus: "nouvelle_demande", note: "Demande reçue via le site" });

      const summary: EmailSummary = {
        reference,
        service: p.service,
        customer: { kind: p.customer.kind, companyName: p.customer.companyName, contactName: p.customer.contactName, phone: p.customer.phone, email: p.customer.email },
        delivery: { recipientName: p.delivery.recipientName, recipientPhone: p.delivery.recipientPhone, line1: p.delivery.address.line1, line2: p.delivery.address.line2, postalCode: p.delivery.address.postalCode, city: p.delivery.address.city },
        placeType: p.site.placeType,
        quantityRequested: p.service === "chauffage" ? calc.quantity : null,
        quantityRecommended: calc.heating?.recommendedUnits ?? null,
        desiredStartDate: p.schedule.desiredStartDate,
        estimatedDays: p.schedule.durationUnknown ? null : p.schedule.estimatedDays ?? null,
        quoteMode: est.mode,
        totalHtCents: est.mode === "estimate" ? est.totalHtCents : null,
        totalTtcCents: est.mode === "estimate" ? est.totalTtcCents : null,
        expressRequested: p.schedule.expressRequested,
        requiresManualReview: calc.requiresManualReview,
      };
      const contactLine = e.LEGAL_EMAIL ? `Pour toute question : ${e.LEGAL_EMAIL}${e.PUBLIC_PHONE ? " · " + e.PUBLIC_PHONE : ""}. Merci de rappeler la référence ${reference}.` : `Merci de rappeler la référence ${reference} dans vos échanges.`;
      const ack = clientAckEmail(summary, e.BRAND_NAME, contactLine);
      const outbox = [
        { requestId: r.id, kind: "client_ack", dedupeKey: `client_ack:${r.id}`, toEmail: p.customer.email, subject: ack.subject, textBody: ack.text, htmlBody: ack.html },
      ];
      if (e.TEAM_NOTIFICATION_EMAIL) {
        const team = teamAlertEmail(summary, e.BRAND_NAME, `${e.APP_URL}/admin/demandes/${r.id}`);
        outbox.push({ requestId: r.id, kind: "team_alert", dedupeKey: `team_alert:${r.id}`, toEmail: e.TEAM_NOTIFICATION_EMAIL, subject: team.subject, textBody: team.text, htmlBody: team.html });
      }
      await tx.insert(notifications).values(outbox);
      await tx.insert(analyticsEvents).values({
        name: "request_submitted", service: p.service, requestId: r.id, path: "/demande",
        utmSource: p.attribution?.utmSource ?? null, utmMedium: p.attribution?.utmMedium ?? null, utmCampaign: p.attribution?.utmCampaign ?? null,
      });
      return { id: r.id, reference, duplicate: false, quoteMode: est.mode };
    });
  } catch (err) {
    // Course entre deux envois simultanés avec la même clé : on renvoie la demande déjà enregistrée.
    if ((err as { code?: string }).code === "23505" || (err as { cause?: { code?: string } }).cause?.code === "23505") {
      const again = await db.select({ id: requests.id, reference: requests.reference, quoteMode: requests.quoteMode })
        .from(requests).where(eq(requests.idempotencyKey, p.idempotencyKey)).limit(1);
      if (again[0]) return { ...again[0], quoteMode: again[0].quoteMode as "estimate" | "sur_devis", duplicate: true };
    }
    throw err;
  }
}
