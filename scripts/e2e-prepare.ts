import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import postgres from "postgres";

/** Prépare la base E2E (lancé par la commande webServer de Playwright AVANT le build). Base E2E isolée : schéma recréé, migrations, paramètres et données de démonstration. */
async function main() {
  const E2E_ENV = { DATABASE_URL: process.env.DATABASE_URL!, MAIL_OUTBOX_DIR: process.env.MAIL_OUTBOX_DIR ?? "test-results/e2e-mail" };
  if (!/rc_e2e|e2e/.test(E2E_ENV.DATABASE_URL)) throw new Error("Refus : la base E2E doit contenir « e2e » dans son nom");
  const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await sql.end();
  rmSync(E2E_ENV.MAIL_OUTBOX_DIR, { recursive: true, force: true });
  const env = { ...process.env };
  execSync("npx tsx scripts/migrate.ts", { env, stdio: "inherit" });
  execSync("npx tsx --conditions=react-server scripts/seed.ts --demo", { env, stdio: "inherit" });
}

main().catch((e) => { console.error(e); process.exit(1); });
