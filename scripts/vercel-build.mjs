// Build Vercel. Par défaut : AUCUNE migration (procédure recommandée : migration manuelle contrôlée, docs/MISE_EN_LIGNE.md étape 5 bis).
// MIGRATE_ON_BUILD=true n'est honoré que pour un déploiement de PRODUCTION Vercel (jamais pour un déploiement Preview),
// et la migration est protégée par un verrou PostgreSQL contre les exécutions concurrentes.
import { execSync } from "node:child_process";
const env = process.env.VERCEL_ENV ?? "local";
if (process.env.MIGRATE_ON_BUILD === "true") {
  if (env === "preview") {
    console.warn("⚠ MIGRATE_ON_BUILD ignoré : un déploiement Preview ne migre jamais une base. Utilisez la procédure manuelle.");
  } else {
    console.log(`→ Migrations (VERCEL_ENV=${env}, verrou actif)…`);
    execSync("npx tsx scripts/migrate.ts", { stdio: "inherit" });
    execSync("npx tsx --conditions=react-server scripts/seed.ts", { stdio: "inherit" }); // paramètres v1 si base vierge (jamais --demo)
  }
}
execSync("npx next build", { stdio: "inherit" });
