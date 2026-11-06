CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"handover_id" uuid,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"resolution_instructions" text NOT NULL,
	"reported_by" uuid NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'ouvert' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "unit_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"allocation_id" uuid,
	"inspected_at" timestamp with time zone NOT NULL,
	"inspector_name" text NOT NULL,
	"checks" jsonb NOT NULL,
	"anomalies" text,
	"condition_before" text NOT NULL,
	"decision" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handover_photos" ADD COLUMN "kind" text DEFAULT 'photo' NOT NULL;--> statement-breakpoint
ALTER TABLE "handover_photos" ADD COLUMN "encryption" text;--> statement-breakpoint
ALTER TABLE "handovers" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "handovers" ADD COLUMN "signature" text;--> statement-breakpoint
ALTER TABLE "handovers" ADD COLUMN "notices" jsonb;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_handover_id_handovers_id_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."handovers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_admin_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_admin_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_inspections" ADD CONSTRAINT "unit_inspections_unit_id_equipment_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."equipment_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_inspections" ADD CONSTRAINT "unit_inspections_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_inspections" ADD CONSTRAINT "unit_inspections_recorded_by_admin_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incidents_open_idx" ON "incidents" USING btree ("status","reported_at");--> statement-breakpoint
CREATE INDEX "incidents_request_idx" ON "incidents" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "unit_inspections_unit_idx" ON "unit_inspections" USING btree ("unit_id","inspected_at");