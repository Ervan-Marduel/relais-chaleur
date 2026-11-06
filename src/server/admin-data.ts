import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  activities, adminUsers, allocations, allocationEvents, customers, deliverySites, documents, equipmentModels, equipmentUnits,
  handovers, handoverItems, handoverPhotos, incidents, notifications, pricingVersions, quotes, requests, statusEvents, auditEvents,
} from "@/db/schema";
import { businessSettingsSchema } from "@/lib/domain/settings";
import { REQUEST_STATUSES, type RequestStatus } from "@/lib/domain/status";

export type RequestFilters = {
  q?: string;
  status?: string;
  service?: string;
  segment?: string;
  zone?: "in" | "out";
  from?: string;
  to?: string;
  view?: string;
};

const ACTIVE: RequestStatus[] = ["nouvelle_demande", "a_qualifier", "devis_a_confirmer", "confirmee", "preparation", "livree", "reprise_planifiee"];

export async function listRequests(db: Db, f: RequestFilters, zonePostalCodes: string[], limit = 200) {
  const conds: SQL[] = [];
  if (f.status && (REQUEST_STATUSES as readonly string[]).includes(f.status)) conds.push(eq(requests.status, f.status as RequestStatus));
  if (f.service === "chauffage" || f.service === "climatisation") conds.push(eq(requests.service, f.service));
  if (f.segment && ["particulier", "entreprise", "syndic", "autre"].includes(f.segment)) conds.push(sql`${customers.kind} = ${f.segment}`);
  if (f.zone === "in" && zonePostalCodes.length) conds.push(inArray(deliverySites.postalCode, zonePostalCodes));
  if (f.zone === "out" && zonePostalCodes.length) conds.push(sql`${deliverySites.postalCode} NOT IN (${sql.join(zonePostalCodes.map((p) => sql`${p}`), sql`, `)})`);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(requests.desiredStartDate, f.from));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lte(requests.desiredStartDate, f.to));
  if (f.view === "a_appeler") conds.push(and(inArray(requests.status, ["nouvelle_demande", "a_qualifier"]), isNull(requests.firstContactAt))!);
  if (f.view === "actives") conds.push(inArray(requests.status, ACTIVE));
  if (f.view === "relances") conds.push(and(lte(requests.nextActionAt, new Date()), inArray(requests.status, ACTIVE))!);
  if (f.q && f.q.trim()) {
    const like = `%${f.q.trim().replace(/[%_]/g, "")}%`;
    conds.push(or(
      ilike(requests.reference, like), ilike(customers.contactName, like), ilike(customers.companyName, like),
      ilike(customers.email, like), ilike(customers.phone, like), ilike(deliverySites.recipientName, like),
      ilike(deliverySites.line1, like), ilike(deliverySites.city, like), ilike(deliverySites.postalCode, like),
      ilike(requests.customerReference, like),
    )!);
  }
  return db
    .select({
      id: requests.id, reference: requests.reference, service: requests.service, status: requests.status,
      createdAt: requests.createdAt, desiredStartDate: requests.desiredStartDate, estimatedDays: requests.estimatedDays,
      quantityRequested: requests.quantityRequested, quantityRecommended: requests.quantityRecommended,
      quoteMode: requests.quoteMode, totalHt: requests.estimatedTotalHtCents, totalTtc: requests.estimatedTotalTtcCents,
      requiresManualReview: requests.requiresManualReview, isErp: requests.isErp, expressRequested: requests.expressRequested,
      firstContactAt: requests.firstContactAt, multiSite: requests.multiSite,
      customerKind: customers.kind, companyName: customers.companyName, contactName: customers.contactName, phone: customers.phone, email: customers.email,
      postalCode: deliverySites.postalCode, city: deliverySites.city, recipientName: deliverySites.recipientName,
      utmSource: sql<string | null>`${requests.attribution}->>'utmSource'`,
    })
    .from(requests)
    .innerJoin(customers, eq(requests.customerId, customers.id))
    .innerJoin(deliverySites, eq(requests.deliverySiteId, deliverySites.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(requests.createdAt))
    .limit(limit);
}

export async function dashboardCounts(db: Db) {
  const [r] = await db.execute<Record<string, number>>(sql`
    SELECT
      count(*) FILTER (WHERE status = 'nouvelle_demande')::int AS nouvelles,
      count(*) FILTER (WHERE status IN ('nouvelle_demande','a_qualifier') AND first_contact_at IS NULL)::int AS a_appeler,
      count(*) FILTER (WHERE status = 'devis_a_confirmer')::int AS devis,
      count(*) FILTER (WHERE status IN ('confirmee'))::int AS confirmees,
      count(*) FILTER (WHERE status IN ('confirmee','preparation'))::int AS livraisons,
      count(*) FILTER (WHERE status IN ('livree'))::int AS reprises_a_programmer,
      count(*) FILTER (WHERE status IN ('reprise_planifiee'))::int AS reprises_planifiees,
      count(*) FILTER (WHERE requires_manual_review AND status IN ('nouvelle_demande','a_qualifier','devis_a_confirmer'))::int AS revues,
      count(*) FILTER (WHERE next_action_at <= now() AND status NOT IN ('cloturee','annulee','refusee','reprise_effective'))::int AS relances,
      count(*) FILTER (WHERE status IN ('nouvelle_demande','a_qualifier') AND first_contact_at IS NULL AND created_at < now() - interval '24 hours')::int AS sans_contact_24h
    FROM requests`);
  const [ops2] = await db.execute<{ incidents_ouverts: number; remises_sans_scan: number; a_controler: number }>(sql`
    SELECT (SELECT count(*) FROM incidents WHERE status = 'ouvert')::int AS incidents_ouverts,
           (SELECT count(*) FROM handovers h WHERE h.kind = 'remise'
              AND NOT EXISTS (SELECT 1 FROM handover_photos p WHERE p.handover_id = h.id AND p.kind = 'bon_signe'))::int AS remises_sans_scan,
           (SELECT count(*) FROM equipment_units u WHERE u.active AND u.condition = 'a_controler'
              AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.unit_id = u.id AND a.status IN ('reservee','remise')))::int AS a_controler`);
  const openIncidents = await db.select({ i: incidents, ref: requests.reference })
    .from(incidents).innerJoin(requests, eq(incidents.requestId, requests.id)).where(eq(incidents.status, "ouvert")).orderBy(asc(incidents.reportedAt)).limit(20);
  const [late] = await db.execute<{ reprises_en_retard: number; appareils_en_retard: number; remises_en_retard: number }>(sql`
    SELECT count(DISTINCT a.request_id) FILTER (WHERE a.status = 'remise' AND a.end_at < now())::int AS reprises_en_retard,
           count(*) FILTER (WHERE a.status = 'remise' AND a.end_at < now())::int AS appareils_en_retard,
           count(DISTINCT a.request_id) FILTER (WHERE a.status = 'reservee' AND a.start_at < now() - interval '1 day')::int AS remises_en_retard
    FROM allocations a`);
  const overdue = await db.execute<{ id: string; reference: string; end_at: Date; n: number; city: string }>(sql`
    SELECT r.id, r.reference, min(a.end_at) AS end_at, count(*)::int AS n, d.city
    FROM allocations a JOIN requests r ON r.id = a.request_id JOIN delivery_sites d ON d.id = r.delivery_site_id
    WHERE a.status = 'remise' AND a.end_at < now() GROUP BY r.id, r.reference, d.city ORDER BY min(a.end_at) LIMIT 10`);
  const [n] = await db.execute<{ failed: number; dead: number; pending: number }>(sql`
    SELECT count(*) FILTER (WHERE status = 'failed')::int AS failed, count(*) FILTER (WHERE status = 'dead')::int AS dead,
           count(*) FILTER (WHERE status IN ('pending','sending'))::int AS pending FROM notifications`);
  const incidentNotes = await db.select({ id: requests.id, reference: requests.reference, note: requests.incidentNote, updatedAt: requests.updatedAt })
    .from(requests).where(sql`${requests.incidentNote} IS NOT NULL`).orderBy(desc(requests.updatedAt)).limit(5);
  const deliveries = await db.select({ id: requests.id, reference: requests.reference, at: requests.confirmedDeliveryAt, status: requests.status, city: deliverySites.city, qty: requests.quantityRequested })
    .from(requests).innerJoin(deliverySites, eq(requests.deliverySiteId, deliverySites.id))
    .where(inArray(requests.status, ["confirmee", "preparation"])).orderBy(asc(requests.confirmedDeliveryAt)).limit(10);
  const pickups = await db.select({ id: requests.id, reference: requests.reference, at: requests.plannedPickupAt, status: requests.status, city: deliverySites.city })
    .from(requests).innerJoin(deliverySites, eq(requests.deliverySiteId, deliverySites.id))
    .where(inArray(requests.status, ["livree", "reprise_planifiee"])).orderBy(asc(requests.plannedPickupAt)).limit(10);
  return { counts: { ...r, ...late, ...ops2 } as Record<string, number>, notif: n, incidents: incidentNotes, openIncidents, deliveries, pickups, overdue };
}

export async function getRequestDetail(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db.select({ r: requests, c: customers, d: deliverySites })
    .from(requests).innerJoin(customers, eq(requests.customerId, customers.id)).innerJoin(deliverySites, eq(requests.deliverySiteId, deliverySites.id))
    .where(eq(requests.id, id)).limit(1);
  if (!rows[0]) return null;
  const [events, acts, qs, allocs, docs, notifs, hos, items, photos, allocEvents, pv, incs] = await Promise.all([
    db.select({ e: statusEvents, actor: adminUsers.name }).from(statusEvents).leftJoin(adminUsers, eq(statusEvents.actorId, adminUsers.id)).where(eq(statusEvents.requestId, id)).orderBy(asc(statusEvents.createdAt)),
    db.select({ a: activities, author: adminUsers.name }).from(activities).innerJoin(adminUsers, eq(activities.authorId, adminUsers.id)).where(eq(activities.requestId, id)).orderBy(desc(activities.createdAt)),
    db.select().from(quotes).where(eq(quotes.requestId, id)).orderBy(desc(quotes.version)),
    db.select({ a: allocations, u: equipmentUnits, m: equipmentModels }).from(allocations).innerJoin(equipmentUnits, eq(allocations.unitId, equipmentUnits.id)).innerJoin(equipmentModels, eq(equipmentUnits.modelId, equipmentModels.id)).where(eq(allocations.requestId, id)).orderBy(asc(equipmentUnits.inventoryCode)),
    db.select({ id: documents.id, number: documents.number, version: documents.version, generatedAt: documents.generatedAt, sha256: documents.sha256, size: sql<number>`octet_length(${documents.content})` }).from(documents).where(eq(documents.requestId, id)).orderBy(desc(documents.version)),
    db.select({ id: notifications.id, kind: notifications.kind, status: notifications.status, attempts: notifications.attempts, lastError: notifications.lastError, sentAt: notifications.sentAt }).from(notifications).where(eq(notifications.requestId, id)),
    db.select({ h: handovers, by: adminUsers.name }).from(handovers).innerJoin(adminUsers, eq(handovers.recordedBy, adminUsers.id)).where(eq(handovers.requestId, id)).orderBy(asc(handovers.occurredAt)),
    db.select({ i: handoverItems }).from(handoverItems).innerJoin(handovers, eq(handoverItems.handoverId, handovers.id)).where(eq(handovers.requestId, id)).orderBy(asc(handoverItems.inventoryCode)),
    db.select({ id: handoverPhotos.id, handoverId: handoverPhotos.handoverId, size: handoverPhotos.sizeBytes, kind: handoverPhotos.kind, encryption: handoverPhotos.encryption, createdAt: handoverPhotos.createdAt }).from(handoverPhotos).innerJoin(handovers, eq(handoverPhotos.handoverId, handovers.id)).where(eq(handovers.requestId, id)),
    db.select({ e: allocationEvents, code: equipmentUnits.inventoryCode, actor: adminUsers.name }).from(allocationEvents).leftJoin(equipmentUnits, eq(allocationEvents.unitId, equipmentUnits.id)).leftJoin(adminUsers, eq(allocationEvents.actorId, adminUsers.id)).where(eq(allocationEvents.requestId, id)).orderBy(asc(allocationEvents.createdAt)),
    db.select({ payload: pricingVersions.payload, version: pricingVersions.version }).from(pricingVersions).where(eq(pricingVersions.id, rows[0].r.pricingVersionId)),
    db.select().from(incidents).where(eq(incidents.requestId, id)).orderBy(asc(incidents.reportedAt)),
  ]);
  const acceptedSettings = businessSettingsSchema.parse(pv[0].payload);
  return { ...rows[0], events, acts, quotes: qs, allocs, docs, notifs, handovers: hos, handoverItems: items.map((x) => x.i), photos, allocEvents, incidents: incs, acceptedSettings, acceptedVersion: pv[0].version };
}

/**
 * Appareils affectables : actifs, état louable (neuf/bon) et SANS affectation ouverte (réservée ou chez un client).
 * La date de reprise prévue n'entre pas en compte : un appareil n'est libre qu'après sa reprise constatée.
 */
export async function availableUnits(db: Db, service: "chauffage" | "climatisation") {
  return db.execute<{ id: string; inventory_code: string; brand: string; model: string; model_id: string; condition: string; lot_number: string | null; serial_number: string | null }>(sql`
    SELECT u.id, u.inventory_code, m.brand, m.model, m.id AS model_id, u.condition, u.lot_number, u.serial_number
    FROM equipment_units u JOIN equipment_models m ON m.id = u.model_id
    WHERE u.active AND m.service = ${service} AND u.condition IN ('neuf','bon')
      AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.unit_id = u.id AND a.status IN ('reservee','remise'))
    ORDER BY u.inventory_code`);
}

export async function kpis(db: Db, days: number) {
  const since = new Date(Date.now() - days * 86400_000);
  const funnel = await db.execute<{ name: string; sessions: number; events: number }>(sql`
    SELECT name, count(DISTINCT session_id)::int AS sessions, count(*)::int AS events
    FROM analytics_events WHERE created_at >= ${since.toISOString()}::timestamptz GROUP BY name`);
  const [ops] = await db.execute<Record<string, number | null>>(sql`
    SELECT count(*)::int AS demandes,
      count(*) FILTER (WHERE status NOT IN ('nouvelle_demande','refusee','annulee'))::int AS qualifiees,
      count(*) FILTER (WHERE confirmed_at IS NOT NULL)::int AS confirmees,
      count(*) FILTER (WHERE delivered_at IS NOT NULL OR status IN ('livree','reprise_planifiee','reprise_effective','cloturee'))::int AS livrees,
      count(*) FILTER (WHERE status IN ('reprise_effective','cloturee'))::int AS reprises,
      round(avg(estimated_total_ht_cents))::int AS panier_moyen_ht,
      round(avg(quantity_requested), 1)::float AS qte_moyenne,
      round(avg(extract(epoch FROM (first_contact_at - created_at)) / 3600) FILTER (WHERE first_contact_at IS NOT NULL), 1)::float AS delai_contact_h,
      round(avg(extract(epoch FROM (confirmed_at - created_at)) / 3600) FILTER (WHERE confirmed_at IS NOT NULL), 1)::float AS delai_confirmation_h,
      sum(incident_cost_cents)::int AS cout_incidents,
      sum(logistics_cost_cents)::int AS cout_logistique,
      sum(distance_km)::float AS km
    FROM requests WHERE created_at >= ${since.toISOString()}::timestamptz`);
  const bySegment = await db.execute<{ k: string; n: number; confirmed: number }>(sql`
    SELECT c.kind AS k, count(*)::int AS n, count(*) FILTER (WHERE r.confirmed_at IS NOT NULL)::int AS confirmed
    FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.created_at >= ${since.toISOString()}::timestamptz GROUP BY 1 ORDER BY 2 DESC`);
  const bySource = await db.execute<{ k: string; n: number; confirmed: number }>(sql`
    SELECT coalesce(attribution->>'utmSource', '(direct / inconnu)') AS k, count(*)::int AS n, count(*) FILTER (WHERE confirmed_at IS NOT NULL)::int AS confirmed
    FROM requests WHERE created_at >= ${since.toISOString()}::timestamptz GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  const byService = await db.execute<{ k: string; n: number; confirmed: number }>(sql`
    SELECT service::text AS k, count(*)::int AS n, count(*) FILTER (WHERE confirmed_at IS NOT NULL)::int AS confirmed
    FROM requests WHERE created_at >= ${since.toISOString()}::timestamptz GROUP BY 1`);
  const byZone = await db.execute<{ k: string; n: number }>(sql`
    SELECT d.postal_code AS k, count(*)::int AS n FROM requests r JOIN delivery_sites d ON d.id = r.delivery_site_id
    WHERE r.created_at >= ${since.toISOString()}::timestamptz GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  const [fleet] = await db.execute<{ units: number; busy: number }>(sql`
    SELECT (SELECT count(*) FROM equipment_units WHERE active)::int AS units,
           (SELECT count(DISTINCT unit_id) FROM allocations WHERE status = 'remise')::int AS busy`);
  const refusals = await db.execute<{ k: string; n: number }>(sql`
    SELECT coalesce(nullif(trim(note), ''), '(sans motif)') AS k, count(*)::int AS n FROM status_events
    WHERE to_status = 'refusee' AND created_at >= ${since.toISOString()}::timestamptz GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  return { funnel, ops, bySegment, bySource, byService, byZone, fleet, refusals };
}

export async function audit(db: Db, actorId: string | null, action: string, entity?: string, entityId?: string, metadata?: Record<string, unknown>) {
  await db.insert(auditEvents).values({ actorId, action, entity, entityId, metadata });
}
