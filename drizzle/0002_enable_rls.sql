-- Défense en profondeur (Supabase) : RLS activé SANS politique sur toutes les tables.
-- Les clés « anon » / « authenticated » de l'API Supabase n'ont donc accès à rien.
-- L'application se connecte avec le rôle propriétaire (non soumis à RLS).
--> statement-breakpoint
ALTER TABLE "admin_users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "admin_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pricing_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "counters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "delivery_sites" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "equipment_models" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "equipment_units" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "status_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "analytics_events" ENABLE ROW LEVEL SECURITY;
