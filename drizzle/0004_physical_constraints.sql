-- P0-1 : la disponibilité d'un appareil dépend de sa restitution CONSTATÉE, plus de la date de reprise prévue.

-- 1) Reprise explicite et TRACÉE des affectations existantes (aucune modification silencieuse).
--    a. anciennes « libérations » manuelles → annulee + motif explicite
UPDATE "allocations" SET "status" = 'annulee', "cancelled_at" = "released_at",
  "cancel_reason" = 'Migration 0004 : libération manuelle de l''ancien système (à vérifier)'
WHERE "released_at" IS NOT NULL;
--> statement-breakpoint
--    b. affectations non libérées d'une demande déjà livrée → remise (date de livraison connue ou prévue)
UPDATE "allocations" a SET "status" = 'remise', "delivered_at" = coalesce(r."delivered_at", a."start_at")
FROM "requests" r
WHERE a."request_id" = r."id" AND a."released_at" IS NULL AND r."status" IN ('livree', 'reprise_planifiee');
--> statement-breakpoint
INSERT INTO "allocation_events" ("allocation_id", "request_id", "unit_id", "kind", "occurred_at", "details")
SELECT "id", "request_id", "unit_id", 'migration', now(),
  jsonb_build_object('migration', '0004', 'status_apres', "status",
    'note', 'Statut déterminé automatiquement depuis l''ancien schéma ; à confirmer par un constat.')
FROM "allocations";
--> statement-breakpoint

-- 2) Un appareil ne peut avoir qu'UNE affectation ouverte (réservée ou chez le client), sans limite de date.
CREATE UNIQUE INDEX "allocations_one_open_per_unit" ON "allocations" ("unit_id")
  WHERE "status" IN ('reservee', 'remise');
--> statement-breakpoint

-- 3) L'ancienne exclusion portait sur la période PRÉVUE et cessait de bloquer après la reprise prévue : remplacée.
ALTER TABLE "allocations" DROP CONSTRAINT IF EXISTS "allocations_no_overlap";
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_physical_no_overlap"
  EXCLUDE USING gist ("unit_id" WITH =, tstzrange("delivered_at", "returned_at", '[)') WITH &&)
  WHERE ("status" IN ('remise', 'retournee') AND "delivered_at" IS NOT NULL);
--> statement-breakpoint

-- 4) Cohérence des statuts.
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_status_valid" CHECK ("status" IN ('reservee', 'remise', 'retournee', 'annulee'));
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_status_facts" CHECK (
  ("status" <> 'remise' OR "delivered_at" IS NOT NULL) AND
  ("status" <> 'retournee' OR ("delivered_at" IS NOT NULL AND "returned_at" IS NOT NULL AND "return_verified_at" IS NOT NULL AND "return_condition" IS NOT NULL)) AND
  ("status" <> 'annulee' OR "cancelled_at" IS NOT NULL) AND
  ("returned_at" IS NULL OR "returned_at" > "delivered_at")
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_return_condition_valid" CHECK ("return_condition" IS NULL OR "return_condition" IN ('conforme', 'degrade', 'incomplet', 'hors_service'));
--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_kind_valid" CHECK ("kind" IN ('remise', 'reprise'));
--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_quantity_positive" CHECK ("quantity" > 0);
--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_qty_confirmed_positive" CHECK ("quantity_confirmed" IS NULL OR "quantity_confirmed" > 0);
--> statement-breakpoint

-- 5) Traces immuables (ni modification ni suppression).
CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Suppression interdite (%)', TG_TABLE_NAME;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER allocation_events_immutable BEFORE UPDATE ON "allocation_events" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE TRIGGER allocation_events_no_delete BEFORE DELETE ON "allocation_events" FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER handovers_immutable BEFORE UPDATE ON "handovers" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE TRIGGER handovers_no_delete BEFORE DELETE ON "handovers" FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER handover_items_immutable BEFORE UPDATE ON "handover_items" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE TRIGGER handover_items_no_delete BEFORE DELETE ON "handover_items" FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER handover_photos_immutable BEFORE UPDATE ON "handover_photos" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
-- Une affectation ne se supprime jamais (on l'annule) ; un constat-faits ne se réécrit pas.
CREATE TRIGGER allocations_no_delete BEFORE DELETE ON "allocations" FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION allocations_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('retournee', 'annulee') THEN
    RAISE EXCEPTION 'Affectation clôturée (%) : non modifiable', OLD.status;
  END IF;
  IF OLD.status = 'remise' AND NEW.status NOT IN ('remise', 'retournee') THEN
    RAISE EXCEPTION 'Matériel remis : seule une reprise constatée peut clôturer l''affectation';
  END IF;
  IF OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
    RAISE EXCEPTION 'Date de remise constatée non modifiable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER allocations_lifecycle BEFORE UPDATE ON "allocations" FOR EACH ROW EXECUTE FUNCTION allocations_guard();
--> statement-breakpoint

-- 6) RLS sur les nouvelles tables (cf. 0002).
ALTER TABLE "allocation_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "handovers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "handover_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "handover_photos" ENABLE ROW LEVEL SECURITY;
