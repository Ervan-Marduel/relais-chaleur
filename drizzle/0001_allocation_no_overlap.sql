-- Anti-chevauchement des affectations fermes d'un même appareil.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_end_after_start" CHECK ("end_at" IS NULL OR "end_at" > "start_at");
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_no_overlap"
  EXCLUDE USING gist ("unit_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&)
  WHERE ("released_at" IS NULL);
--> statement-breakpoint
-- Un seul devis ou bon par version ; empêche toute modification des devis figés.
CREATE OR REPLACE FUNCTION forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Enregistrement immuable (%)', TG_TABLE_NAME;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER quotes_immutable BEFORE UPDATE ON "quotes" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE TRIGGER pricing_versions_payload_immutable BEFORE UPDATE OF "payload", "version" ON "pricing_versions" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE TRIGGER documents_immutable BEFORE UPDATE ON "documents" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE TRIGGER status_events_immutable BEFORE UPDATE ON "status_events" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE TRIGGER requests_estimate_immutable BEFORE UPDATE OF "estimate_snapshot", "pricing_version_id", "estimated_total_ht_cents", "estimated_total_ttc_cents", "quantity_recommended", "terms_version", "privacy_version", "consent_at", "reference", "idempotency_key" ON "requests" FOR EACH ROW EXECUTE FUNCTION forbid_update();
