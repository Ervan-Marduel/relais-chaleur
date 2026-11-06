CREATE TABLE "allocation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid,
	"request_id" uuid NOT NULL,
	"unit_id" uuid,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handover_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handover_id" uuid NOT NULL,
	"allocation_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"inventory_code" text NOT NULL,
	"condition" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "handover_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handover_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"content" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"agent_name" text NOT NULL,
	"recipient_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"quantity_expected" integer,
	"quantity_justification" text,
	"notice_given" boolean,
	"general_condition" text,
	"reserves" text,
	"paper_signed" boolean DEFAULT false NOT NULL,
	"bon_document_id" uuid,
	"corrects_handover_id" uuid,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "status" text DEFAULT 'reservee' NOT NULL;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "delivery_handover_id" uuid;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "return_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "return_condition" text;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "return_handover_id" uuid;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "quantity_confirmed" integer;--> statement-breakpoint
ALTER TABLE "allocation_events" ADD CONSTRAINT "allocation_events_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_events" ADD CONSTRAINT "allocation_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_events" ADD CONSTRAINT "allocation_events_unit_id_equipment_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."equipment_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_events" ADD CONSTRAINT "allocation_events_actor_id_admin_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_items" ADD CONSTRAINT "handover_items_handover_id_handovers_id_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."handovers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_items" ADD CONSTRAINT "handover_items_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_items" ADD CONSTRAINT "handover_items_unit_id_equipment_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."equipment_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_photos" ADD CONSTRAINT "handover_photos_handover_id_handovers_id_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."handovers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_photos" ADD CONSTRAINT "handover_photos_uploaded_by_admin_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_bon_document_id_documents_id_fk" FOREIGN KEY ("bon_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_recorded_by_admin_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocation_events_request_idx" ON "allocation_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "allocation_events_unit_idx" ON "allocation_events" USING btree ("unit_id","created_at");--> statement-breakpoint
CREATE INDEX "handover_items_handover_idx" ON "handover_items" USING btree ("handover_id");--> statement-breakpoint
CREATE INDEX "handovers_request_idx" ON "handovers" USING btree ("request_id","occurred_at");