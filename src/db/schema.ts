import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, integer, boolean, timestamp, jsonb, date, numeric, index, uniqueIndex, customType, pgEnum, check,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const serviceEnum = pgEnum("service_kind", ["chauffage", "climatisation"]);
export const requestStatusEnum = pgEnum("request_status", [
  "nouvelle_demande", "a_qualifier", "devis_a_confirmer", "confirmee", "preparation", "livree",
  "reprise_planifiee", "reprise_effective", "cloturee", "refusee", "annulee",
]);
export const clientKindEnum = pgEnum("client_kind", ["particulier", "entreprise", "syndic", "autre"]);
export const roleEnum = pgEnum("admin_role", ["admin", "commercial", "preparateur", "exploitant"]);
export const unitConditionEnum = pgEnum("unit_condition", ["neuf", "bon", "a_controler", "hors_service"]);
export const notificationStatusEnum = pgEnum("notification_status", ["pending", "sending", "sent", "failed", "dead"]);

// ───────────────────────── Administration ─────────────────────────
export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("admin"),
  active: boolean("active").notNull().default(true),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastLoginAt: ts("last_login_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("admin_users_email_uq").on(sql`lower(${t.email})`)]);

export const adminSessions = pgTable("admin_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull(),
  userId: uuid("user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("admin_sessions_token_uq").on(t.tokenHash), index("admin_sessions_user_idx").on(t.userId)]);

// ───────────────────────── Paramètres versionnés ─────────────────────────
export const pricingVersions = pgTable("pricing_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: integer("version").notNull(),
  payload: jsonb("payload").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  note: text("note"),
  createdBy: uuid("created_by").references(() => adminUsers.id),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pricing_versions_version_uq").on(t.version),
  uniqueIndex("pricing_versions_one_active").on(t.isActive).where(sql`${t.isActive} = true`),
]);

/** Compteurs atomiques pour références lisibles (RC-2026-000001, BR-2026-000001). */
export const counters = pgTable("counters", {
  scope: text("scope").primaryKey(),
  value: integer("value").notNull(),
});

// ───────────────────────── Clients / sites / demandes ─────────────────────────
/** Donneur d'ordre (client qui commande). Distinct du réceptionnaire. */
export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: clientKindEnum("kind").notNull(),
  companyName: text("company_name"),
  siret: text("siret"),
  contactName: text("contact_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  billingLine1: text("billing_line1"),
  billingLine2: text("billing_line2"),
  billingPostalCode: text("billing_postal_code"),
  billingCity: text("billing_city"),
  createdAt: ts("created_at").notNull().defaultNow(),
  anonymizedAt: ts("anonymized_at"),
}, (t) => [index("customers_email_idx").on(sql`lower(${t.email})`), check("siret_pro_only", sql`${t.siret} IS NULL OR ${t.kind} <> 'particulier'`)]);

/** Lieu de livraison + personne qui réceptionne (peut être un locataire, un gardien…). */
export const deliverySites = pgTable("delivery_sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipientName: text("recipient_name").notNull(),
  recipientPhone: text("recipient_phone").notNull(),
  line1: text("line1").notNull(),
  line2: text("line2"),
  postalCode: text("postal_code").notNull(),
  city: text("city").notNull(),
  floor: text("floor"),
  elevator: text("elevator"),
  parking: text("parking"),
  accessInstructions: text("access_instructions"),
  preferredHours: text("preferred_hours"),
  placeType: text("place_type").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const requests = pgTable("requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  reference: text("reference").notNull(),
  service: serviceEnum("service").notNull(),
  status: requestStatusEnum("status").notNull().default("nouvelle_demande"),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  deliverySiteId: uuid("delivery_site_id").notNull().references(() => deliverySites.id),
  /** Dossier parent pour des demandes multi-sites ventilées (phase 2). */
  parentRequestId: uuid("parent_request_id"),
  placeType: text("place_type").notNull(),
  isErp: boolean("is_erp").notNull().default(false),
  multiSite: boolean("multi_site").notNull().default(false),
  siteCount: integer("site_count"),
  multiSiteDetails: text("multi_site_details"),
  // Besoin (entrées brutes conservées)
  needInput: jsonb("need_input").notNull(),
  surfaceM2: numeric("surface_m2", { precision: 8, scale: 2 }),
  rooms: integer("rooms"),
  ceilingHeightM: numeric("ceiling_height_m", { precision: 4, scale: 2 }),
  insulation: text("insulation"),
  /** Quantité calculée par l'estimateur ET quantité souhaitée : les deux sont conservées. */
  quantityRecommended: integer("quantity_recommended"),
  quantityRequested: integer("quantity_requested"),
  estimatedPowerW: integer("estimated_power_w"),
  requiresManualReview: boolean("requires_manual_review").notNull().default(false),
  // Calendrier souhaité (jamais présenté comme confirmé)
  desiredStartDate: date("desired_start_date").notNull(),
  estimatedDays: integer("estimated_days"),
  durationUnknown: boolean("duration_unknown").notNull().default(false),
  plannedReturnDate: date("planned_return_date"),
  expressRequested: boolean("express_requested").notNull().default(false),
  customerReference: text("customer_reference"),
  notes: text("notes"),
  // Prix estimatif FIGÉ (calculé serveur)
  pricingVersionId: uuid("pricing_version_id").notNull().references(() => pricingVersions.id),
  estimateSnapshot: jsonb("estimate_snapshot").notNull(),
  quoteMode: text("quote_mode").notNull(), // 'estimate' | 'sur_devis'
  estimatedTotalHtCents: integer("estimated_total_ht_cents"),
  estimatedTotalTtcCents: integer("estimated_total_ttc_cents"),
  // Consentements (versions + horodatage serveur)
  termsVersion: text("terms_version").notNull(),
  privacyVersion: text("privacy_version").notNull(),
  consentAt: ts("consent_at").notNull(),
  // Anti-doublon, attribution minimisée
  idempotencyKey: text("idempotency_key").notNull(),
  attribution: jsonb("attribution"),
  // Exploitation
  assignedTo: uuid("assigned_to").references(() => adminUsers.id),
  nextActionAt: ts("next_action_at"),
  confirmedDeliveryAt: ts("confirmed_delivery_at"),
  confirmedDeliverySlot: text("confirmed_delivery_slot"),
  plannedPickupAt: ts("planned_pickup_at"),
  confirmationChecks: jsonb("confirmation_checks"),
  technicalNote: text("technical_note"),
  equipmentModelId: uuid("equipment_model_id"),
  /** Quantité confirmée par l'équipe (peut différer de la quantité souhaitée par le client, qui reste conservée). */
  quantityConfirmed: integer("quantity_confirmed"),
  firstContactAt: ts("first_contact_at"),
  confirmedAt: ts("confirmed_at"),
  deliveredAt: ts("delivered_at"),
  returnedAt: ts("returned_at"),
  // Phase 2 — rentabilité (champs prévus, saisis en back-office)
  logisticsCostCents: integer("logistics_cost_cents"),
  handlingMinutes: integer("handling_minutes"),
  distanceKm: numeric("distance_km", { precision: 7, scale: 1 }),
  incidentCostCents: integer("incident_cost_cents"),
  incidentNote: text("incident_note"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("requests_reference_uq").on(t.reference),
  uniqueIndex("requests_idem_uq").on(t.idempotencyKey),
  index("requests_status_idx").on(t.status, t.createdAt),
  index("requests_created_idx").on(t.createdAt),
  index("requests_start_idx").on(t.desiredStartDate),
  check("qty_positive", sql`${t.quantityRequested} IS NULL OR ${t.quantityRequested} > 0`),
]);

/** Devis versionnés : chaque version est IMMUABLE (prix figés). */
export const quotes = pgTable("quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  lines: jsonb("lines").notNull(),
  totalHtCents: integer("total_ht_cents").notNull(),
  vatRateBp: integer("vat_rate_bp").notNull(),
  totalTtcCents: integer("total_ttc_cents").notNull(),
  pricingVersionId: uuid("pricing_version_id").references(() => pricingVersions.id),
  note: text("note"),
  createdBy: uuid("created_by").notNull().references(() => adminUsers.id),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("quotes_request_version_uq").on(t.requestId, t.version)]);

// ───────────────────────── Catalogue & parc ─────────────────────────
export const equipmentModels = pgTable("equipment_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  service: serviceEnum("service").notNull(),
  brand: text("brand").notNull(),
  model: text("model").notNull(),
  manufacturerRef: text("manufacturer_ref"),
  electricalPowerW: integer("electrical_power_w"),
  coolingPowerW: integer("cooling_power_w"),
  coolingBtu: integer("cooling_btu"),
  noticeUrl: text("notice_url"),
  noticeVersion: text("notice_version"),
  placementRestrictions: text("placement_restrictions"),
  /** true seulement si la référence a été vérifiée sur l'appareil / la notice. */
  referenceVerified: boolean("reference_verified").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const equipmentUnits = pgTable("equipment_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  inventoryCode: text("inventory_code").notNull(), // RC-001…
  modelId: uuid("model_id").notNull().references(() => equipmentModels.id),
  /** Numéro de série constructeur UNIQUEMENT s'il existe réellement sur l'appareil. */
  serialNumber: text("serial_number"),
  /** Numéro de lot (partagé entre appareils) : jamais utilisé comme identifiant unique. */
  lotNumber: text("lot_number"),
  condition: unitConditionEnum("condition").notNull().default("a_controler"),
  conditionCheckedAt: ts("condition_checked_at"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("equipment_units_code_uq").on(t.inventoryCode),
  uniqueIndex("equipment_units_serial_uq").on(t.modelId, t.serialNumber).where(sql`${t.serialNumber} IS NOT NULL`),
]);

/**
 * Affectation d'un appareil à une demande.
 *
 * DISPONIBILITÉ PHYSIQUE (migration 0004) : une affectation « ouverte » (statut reservee ou remise)
 * bloque l'appareil SANS limite de date tant qu'un constat de reprise n'a pas été enregistré et
 * contrôlé (return_verified_at). Index unique partiel : un appareil n'a jamais deux affectations
 * ouvertes. `start_at` / `end_at` ne sont que la PLANIFICATION (livraison / reprise prévues).
 * Contrainte d'exclusion sur les périodes PHYSIQUES [delivered_at, returned_at) : l'historique
 * ne peut pas montrer un appareil chez deux clients en même temps.
 */
export const allocationStatusEnum = ["reservee", "remise", "retournee", "annulee"] as const;
export const allocations = pgTable("allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  unitId: uuid("unit_id").notNull().references(() => equipmentUnits.id),
  /** Planification : livraison prévue. */
  startAt: ts("start_at").notNull(),
  /** Planification : reprise prévue (null = non fixée). N'a AUCUN effet sur la disponibilité. */
  endAt: ts("end_at"),
  status: text("status", { enum: allocationStatusEnum }).notNull().default("reservee"),
  deliveredAt: ts("delivered_at"),
  deliveryHandoverId: uuid("delivery_handover_id"),
  returnedAt: ts("returned_at"),
  returnVerifiedAt: ts("return_verified_at"),
  returnCondition: text("return_condition"),
  returnHandoverId: uuid("return_handover_id"),
  cancelledAt: ts("cancelled_at"),
  cancelReason: text("cancel_reason"),
  /** Ancien mécanisme de libération (avant 0004) — conservé pour l'historique, plus utilisé. */
  releasedAt: ts("released_at"),
  createdBy: uuid("created_by").notNull().references(() => adminUsers.id),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("allocations_request_idx").on(t.requestId), index("allocations_unit_idx").on(t.unitId)]);

/** Journal IMMUABLE de la vie de chaque affectation (réservation, remise, reprise, annulation, prolongation, exception). */
export const allocationEvents = pgTable("allocation_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  allocationId: uuid("allocation_id").references(() => allocations.id),
  requestId: uuid("request_id").notNull().references(() => requests.id),
  unitId: uuid("unit_id").references(() => equipmentUnits.id),
  kind: text("kind").notNull(),
  occurredAt: ts("occurred_at").notNull(),
  actorId: uuid("actor_id").references(() => adminUsers.id),
  details: jsonb("details"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("allocation_events_request_idx").on(t.requestId, t.createdAt), index("allocation_events_unit_idx").on(t.unitId, t.createdAt)]);

/**
 * Constat structuré de REMISE ou de REPRISE (saisie administrative des faits réels constatés sur le bon papier).
 * Immuable : une erreur se corrige par un nouveau constat qui référence le précédent (corrects_handover_id).
 */
export const handovers = pgTable("handovers", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => requests.id),
  kind: text("kind", { enum: ["remise", "reprise"] }).notNull(),
  /** Date et heure RÉELLES (saisies, Europe/Paris → UTC). */
  occurredAt: ts("occurred_at").notNull(),
  agentName: text("agent_name").notNull(),
  recipientName: text("recipient_name").notNull(),
  quantity: integer("quantity").notNull(),
  quantityExpected: integer("quantity_expected"),
  quantityJustification: text("quantity_justification"),
  noticeGiven: boolean("notice_given"),
  generalCondition: text("general_condition"),
  reserves: text("reserves"),
  paperSigned: boolean("paper_signed").notNull().default(false),
  /** Issue qualifiée (0005) : conforme | avec_reserves | incident. NULL = constat antérieur à 0005 (non qualifié). */
  outcome: text("outcome"),
  /** signe | refus | non_recueilli */
  signature: text("signature"),
  /** Notice remise PAR MODÈLE : { [modelId]: { label, given } } */
  notices: jsonb("notices"),
  bonDocumentId: uuid("bon_document_id").references(() => documents.id),
  correctsHandoverId: uuid("corrects_handover_id"),
  recordedBy: uuid("recorded_by").notNull().references(() => adminUsers.id),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
}, (t) => [index("handovers_request_idx").on(t.requestId, t.occurredAt)]);

export const handoverItems = pgTable("handover_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoverId: uuid("handover_id").notNull().references(() => handovers.id),
  allocationId: uuid("allocation_id").notNull().references(() => allocations.id),
  unitId: uuid("unit_id").notNull().references(() => equipmentUnits.id),
  inventoryCode: text("inventory_code").notNull(),
  condition: text("condition"),
  note: text("note"),
}, (t) => [index("handover_items_handover_idx").on(t.handoverId)]);

/**
 * Pièces jointes d'un constat : photos facultatives et SCAN DU BON SIGNÉ (kind = bon_signe).
 * Contenu chiffré AES-256-GCM si FILE_ENCRYPTION_KEY est défini (colonne encryption). Accès authentifié uniquement.
 */
export const handoverPhotos = pgTable("handover_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoverId: uuid("handover_id").notNull().references(() => handovers.id),
  kind: text("kind").notNull().default("photo"),
  encryption: text("encryption"),
  contentType: text("content_type").notNull(),
  content: bytea("content").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedBy: uuid("uploaded_by").notNull().references(() => adminUsers.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ───────────────────────── Documents, historique, notifications ─────────────────────────
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'bon_remise_reprise'
  number: text("number").notNull(), // BR-2026-000001 (stable pour une demande)
  version: integer("version").notNull(),
  contentType: text("content_type").notNull().default("application/pdf"),
  content: bytea("content").notNull(),
  sha256: text("sha256").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  generatedBy: uuid("generated_by").notNull().references(() => adminUsers.id),
  generatedAt: ts("generated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("documents_number_version_uq").on(t.number, t.version), index("documents_request_idx").on(t.requestId)]);

export const statusEvents = pgTable("status_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  fromStatus: requestStatusEnum("from_status"),
  toStatus: requestStatusEnum("to_status").notNull(),
  actorId: uuid("actor_id").references(() => adminUsers.id), // null = système (création)
  note: text("note"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("status_events_request_idx").on(t.requestId, t.createdAt)]);

/** Notes internes, appels, emails envoyés manuellement. */
export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'note' | 'appel' | 'email'
  body: text("body").notNull(),
  authorId: uuid("author_id").notNull().references(() => adminUsers.id),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("activities_request_idx").on(t.requestId, t.createdAt)]);

/** Boîte d'envoi transactionnelle (outbox) — retries sans double envoi. */
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").references(() => requests.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'client_ack' | 'team_alert'
  dedupeKey: text("dedupe_key").notNull(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  textBody: text("text_body").notNull(),
  htmlBody: text("html_body").notNull(),
  status: notificationStatusEnum("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
  lockedUntil: ts("locked_until"),
  lastError: text("last_error"),
  providerMessageId: text("provider_message_id"),
  sentAt: ts("sent_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("notifications_dedupe_uq").on(t.dedupeKey), index("notifications_due_idx").on(t.status, t.nextAttemptAt)]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => adminUsers.id),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("audit_events_created_idx").on(t.createdAt)]);

/** Limitation de débit (clé = hash IP + route), fenêtre fixe. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

/** Analytique d'entonnoir sans cookie ni IP : identifiant de session aléatoire côté navigateur. */
export const analyticsEvents = pgTable("analytics_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  sessionId: text("session_id"),
  path: text("path"),
  service: text("service"),
  requestId: uuid("request_id"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("analytics_events_name_idx").on(t.name, t.createdAt)]);

/**
 * CONTRÔLE TECHNIQUE (0005) — seule voie pour rendre un appareil louable après un retour ou une réception.
 * Immuable ; distinct de l'événement de reprise physique.
 */
export const unitInspections = pgTable("unit_inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  unitId: uuid("unit_id").notNull().references(() => equipmentUnits.id),
  /** Affectation (retour) qui a déclenché le contrôle, si applicable. */
  allocationId: uuid("allocation_id").references(() => allocations.id),
  inspectedAt: ts("inspected_at").notNull(),
  inspectorName: text("inspector_name").notNull(),
  checks: jsonb("checks").notNull(),
  anomalies: text("anomalies"),
  conditionBefore: text("condition_before").notNull(),
  decision: text("decision").notNull(), // neuf | bon | hors_service
  recordedBy: uuid("recorded_by").notNull().references(() => adminUsers.id),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
}, (t) => [index("unit_inspections_unit_idx").on(t.unitId, t.inspectedAt)]);

/** Incidents de remise / reprise (notice non remise, refus ou absence de signature…). Seule la résolution est modifiable. */
export const incidents = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => requests.id),
  handoverId: uuid("handover_id").references(() => handovers.id),
  kind: text("kind").notNull(),
  description: text("description").notNull(),
  resolutionInstructions: text("resolution_instructions").notNull(),
  reportedBy: uuid("reported_by").notNull().references(() => adminUsers.id),
  reportedAt: ts("reported_at").notNull().defaultNow(),
  status: text("status").notNull().default("ouvert"),
  resolvedAt: ts("resolved_at"),
  resolvedBy: uuid("resolved_by").references(() => adminUsers.id),
  resolutionNote: text("resolution_note"),
}, (t) => [index("incidents_open_idx").on(t.status, t.reportedAt), index("incidents_request_idx").on(t.requestId)]);
