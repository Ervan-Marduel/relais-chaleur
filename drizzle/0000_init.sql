CREATE TYPE "public"."client_kind" AS ENUM('particulier', 'entreprise', 'syndic', 'autre');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sending', 'sent', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('nouvelle_demande', 'a_qualifier', 'devis_a_confirmer', 'confirmee', 'preparation', 'livree', 'reprise_planifiee', 'reprise_effective', 'cloturee', 'refusee', 'annulee');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('admin', 'commercial', 'preparateur', 'exploitant');--> statement-breakpoint
CREATE TYPE "public"."service_kind" AS ENUM('chauffage', 'climatisation');--> statement-breakpoint
CREATE TYPE "public"."unit_condition" AS ENUM('neuf', 'bon', 'a_controler', 'hors_service');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" DEFAULT 'admin' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"session_id" text,
	"path" text,
	"service" text,
	"request_id" uuid,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"scope" text PRIMARY KEY NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "client_kind" NOT NULL,
	"company_name" text,
	"siret" text,
	"contact_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"billing_line1" text,
	"billing_line2" text,
	"billing_postal_code" text,
	"billing_city" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"anonymized_at" timestamp with time zone,
	CONSTRAINT "siret_pro_only" CHECK ("customers"."siret" IS NULL OR "customers"."kind" <> 'particulier')
);
--> statement-breakpoint
CREATE TABLE "delivery_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"postal_code" text NOT NULL,
	"city" text NOT NULL,
	"floor" text,
	"elevator" text,
	"parking" text,
	"access_instructions" text,
	"preferred_hours" text,
	"place_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"version" integer NOT NULL,
	"content_type" text DEFAULT 'application/pdf' NOT NULL,
	"content" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"generated_by" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" "service_kind" NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"manufacturer_ref" text,
	"electrical_power_w" integer,
	"cooling_power_w" integer,
	"cooling_btu" integer,
	"notice_url" text,
	"notice_version" text,
	"placement_restrictions" text,
	"reference_verified" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_code" text NOT NULL,
	"model_id" uuid NOT NULL,
	"serial_number" text,
	"lot_number" text,
	"condition" "unit_condition" DEFAULT 'a_controler' NOT NULL,
	"condition_checked_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"text_body" text NOT NULL,
	"html_body" text NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"lines" jsonb NOT NULL,
	"total_ht_cents" integer NOT NULL,
	"vat_rate_bp" integer NOT NULL,
	"total_ttc_cents" integer NOT NULL,
	"pricing_version_id" uuid,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"service" "service_kind" NOT NULL,
	"status" "request_status" DEFAULT 'nouvelle_demande' NOT NULL,
	"customer_id" uuid NOT NULL,
	"delivery_site_id" uuid NOT NULL,
	"parent_request_id" uuid,
	"place_type" text NOT NULL,
	"is_erp" boolean DEFAULT false NOT NULL,
	"multi_site" boolean DEFAULT false NOT NULL,
	"site_count" integer,
	"multi_site_details" text,
	"need_input" jsonb NOT NULL,
	"surface_m2" numeric(8, 2),
	"rooms" integer,
	"ceiling_height_m" numeric(4, 2),
	"insulation" text,
	"quantity_recommended" integer,
	"quantity_requested" integer,
	"estimated_power_w" integer,
	"requires_manual_review" boolean DEFAULT false NOT NULL,
	"desired_start_date" date NOT NULL,
	"estimated_days" integer,
	"duration_unknown" boolean DEFAULT false NOT NULL,
	"planned_return_date" date,
	"express_requested" boolean DEFAULT false NOT NULL,
	"customer_reference" text,
	"notes" text,
	"pricing_version_id" uuid NOT NULL,
	"estimate_snapshot" jsonb NOT NULL,
	"quote_mode" text NOT NULL,
	"estimated_total_ht_cents" integer,
	"estimated_total_ttc_cents" integer,
	"terms_version" text NOT NULL,
	"privacy_version" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"attribution" jsonb,
	"assigned_to" uuid,
	"next_action_at" timestamp with time zone,
	"confirmed_delivery_at" timestamp with time zone,
	"confirmed_delivery_slot" text,
	"planned_pickup_at" timestamp with time zone,
	"confirmation_checks" jsonb,
	"technical_note" text,
	"equipment_model_id" uuid,
	"first_contact_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"logistics_cost_cents" integer,
	"handling_minutes" integer,
	"distance_km" numeric(7, 1),
	"incident_cost_cents" integer,
	"incident_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qty_positive" CHECK ("requests"."quantity_requested" IS NULL OR "requests"."quantity_requested" > 0)
);
--> statement-breakpoint
CREATE TABLE "status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"from_status" "request_status",
	"to_status" "request_status" NOT NULL,
	"actor_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_author_id_admin_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_unit_id_equipment_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."equipment_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_admin_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_generated_by_admin_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_units" ADD CONSTRAINT "equipment_units_model_id_equipment_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."equipment_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_pricing_version_id_pricing_versions_id_fk" FOREIGN KEY ("pricing_version_id") REFERENCES "public"."pricing_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_delivery_site_id_delivery_sites_id_fk" FOREIGN KEY ("delivery_site_id") REFERENCES "public"."delivery_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_pricing_version_id_pricing_versions_id_fk" FOREIGN KEY ("pricing_version_id") REFERENCES "public"."pricing_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_assigned_to_admin_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_events" ADD CONSTRAINT "status_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_events" ADD CONSTRAINT "status_events_actor_id_admin_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_request_idx" ON "activities" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_uq" ON "admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_sessions_user_idx" ON "admin_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_uq" ON "admin_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "allocations_request_idx" ON "allocations" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "allocations_unit_idx" ON "allocations" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "analytics_events_name_idx" ON "analytics_events" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "documents_number_version_uq" ON "documents" USING btree ("number","version");--> statement-breakpoint
CREATE INDEX "documents_request_idx" ON "documents" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_units_code_uq" ON "equipment_units" USING btree ("inventory_code");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_units_serial_uq" ON "equipment_units" USING btree ("model_id","serial_number") WHERE "equipment_units"."serial_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_versions_version_uq" ON "pricing_versions" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_versions_one_active" ON "pricing_versions" USING btree ("is_active") WHERE "pricing_versions"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_request_version_uq" ON "quotes" USING btree ("request_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_reference_uq" ON "requests" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_idem_uq" ON "requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "requests_status_idx" ON "requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "requests_created_idx" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "requests_start_idx" ON "requests" USING btree ("desired_start_date");--> statement-breakpoint
CREATE INDEX "status_events_request_idx" ON "status_events" USING btree ("request_id","created_at");