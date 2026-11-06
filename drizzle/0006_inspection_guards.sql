-- P0-A : un appareil ne devient louable (neuf/bon) qu'après un CONTRÔLE TECHNIQUE enregistré.
ALTER TABLE "unit_inspections" ADD CONSTRAINT "unit_inspections_decision_valid" CHECK ("decision" IN ('neuf', 'bon', 'hors_service'));
--> statement-breakpoint
CREATE TRIGGER unit_inspections_immutable BEFORE UPDATE ON "unit_inspections" FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
CREATE TRIGGER unit_inspections_no_delete BEFORE DELETE ON "unit_inspections" FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION units_condition_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.condition NOT IN ('a_controler', 'hors_service') THEN
      RAISE EXCEPTION 'Un nouvel appareil entre « à contrôler » : passez par le contrôle technique';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.condition IN ('neuf', 'bon') AND NEW.condition IS DISTINCT FROM OLD.condition THEN
    -- l'inspection doit avoir été enregistrée dans la MÊME transaction, avec cette décision
    IF NOT EXISTS (SELECT 1 FROM unit_inspections i WHERE i.unit_id = NEW.id AND i.decision = NEW.condition::text AND i.recorded_at = now()) THEN
      RAISE EXCEPTION 'Contrôle technique requis avant de rendre l''appareil louable';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER equipment_units_condition_guard BEFORE INSERT OR UPDATE OF "condition" ON "equipment_units" FOR EACH ROW EXECUTE FUNCTION units_condition_guard();
--> statement-breakpoint

-- P0-B : issue de remise qualifiée ; « conforme » impossible sans signature ET notice.
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_outcome_valid" CHECK ("outcome" IS NULL OR "outcome" IN ('conforme', 'avec_reserves', 'incident'));
--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_signature_valid" CHECK ("signature" IS NULL OR "signature" IN ('signe', 'refus', 'non_recueilli'));
--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_conforme_requires_proof" CHECK (
  "outcome" IS DISTINCT FROM 'conforme' OR ("signature" = 'signe' AND ("kind" = 'reprise' OR "notice_given" IS TRUE))
);
--> statement-breakpoint
ALTER TABLE "handover_photos" ADD CONSTRAINT "handover_photos_kind_valid" CHECK ("kind" IN ('photo', 'bon_signe'));
--> statement-breakpoint
CREATE TRIGGER handover_photos_no_delete BEFORE DELETE ON "handover_photos" FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_status_valid" CHECK ("status" IN ('ouvert', 'resolu'));
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_kind_valid" CHECK ("kind" IN ('notice_non_remise', 'refus_signature', 'signature_non_recueillie', 'autre'));
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolution_facts" CHECK ("status" = 'ouvert' OR ("resolved_at" IS NOT NULL AND "resolved_by" IS NOT NULL AND length(coalesce("resolution_note", '')) >= 5));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION incidents_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'ouvert' THEN RAISE EXCEPTION 'Incident clôturé : non modifiable'; END IF;
  IF NEW.request_id <> OLD.request_id OR NEW.handover_id IS DISTINCT FROM OLD.handover_id OR NEW.kind <> OLD.kind
     OR NEW.description <> OLD.description OR NEW.resolution_instructions <> OLD.resolution_instructions
     OR NEW.reported_by <> OLD.reported_by OR NEW.reported_at <> OLD.reported_at THEN
    RAISE EXCEPTION 'Seule la résolution d''un incident peut être renseignée';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER incidents_lifecycle BEFORE UPDATE ON "incidents" FOR EACH ROW EXECUTE FUNCTION incidents_guard();
--> statement-breakpoint
CREATE TRIGGER incidents_no_delete BEFORE DELETE ON "incidents" FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
ALTER TABLE "unit_inspections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "incidents" ENABLE ROW LEVEL SECURITY;
