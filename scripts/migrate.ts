/**
 * Applique les migrations SQL versionnées (dossier drizzle/) — UNE exécution contrôlée par environnement.
 *  - Verrou consultatif PostgreSQL : deux exécutions simultanées ne peuvent pas migrer en même temps
 *    (la seconde attend, puis ne trouve plus rien à appliquer).
 *  - Idempotent : les migrations déjà appliquées sont ignorées (table drizzle.__drizzle_migrations).
 *  - Affiche l'état avant/après et vérifie les garde-fous de la migration 0006.
 * Usage : MIGRATION_DATABASE_URL=… npm run db:migrate      (vérification seule : npm run db:status)
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readFileSync } from "node:fs";

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const checkOnly = process.argv.includes("--check");
if (!url) {
  console.error("DATABASE_URL (ou MIGRATION_DATABASE_URL) manquant.");
  process.exit(1);
}
const LOCK_KEY = 7_315_002_026; // identifiant arbitraire et fixe du verrou de migration Relais Chaleur
const local = /localhost|127\.0\.0\.1/.test(url);
const sql = postgres(url, { max: 1, ssl: process.env.DATABASE_SSL === "disable" || local ? false : "require", onnotice: () => {} });
const expected: { tag: string }[] = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")).entries;
const host = (() => { try { return new URL(url).host; } catch { return "?"; } })();

async function applied(): Promise<number> {
  const [t] = await sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (!t.t) return 0;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
  return n;
}

/** Vérifie la présence des garde-fous critiques (0004 et 0006). */
async function verifyGuards() {
  const checks: [string, string][] = [
    ["index « une affectation ouverte par appareil » (0004)", "SELECT 1 FROM pg_indexes WHERE indexname = 'allocations_one_open_per_unit'"],
    ["déclencheur « contrôle technique obligatoire » (0006)", "SELECT 1 FROM pg_trigger WHERE tgname = 'equipment_units_condition_guard'"],
    ["contrainte « remise conforme = signature + notice » (0006)", "SELECT 1 FROM pg_constraint WHERE conname = 'handovers_conforme_requires_proof'"],
    ["table des contrôles techniques (0005)", "SELECT 1 FROM pg_tables WHERE tablename = 'unit_inspections'"],
    ["table des incidents (0005)", "SELECT 1 FROM pg_tables WHERE tablename = 'incidents'"],
  ];
  let ok = true;
  for (const [label, q] of checks) {
    const r = await sql.unsafe(q);
    console.log(`  ${r.length ? "✔" : "✘"} ${label}`);
    ok &&= r.length > 0;
  }
  return ok;
}

try {
  const before = await applied();
  console.log(`Base : ${host} — migrations appliquées : ${before}/${expected.length} (dernière attendue : ${expected.at(-1)?.tag})`);
  if (checkOnly) {
    const ok = before === expected.length && (await verifyGuards());
    console.log(ok ? "État conforme ✔" : "État NON conforme ✘ — appliquez les migrations (procédure docs/MISE_EN_LIGNE.md, étape 5 bis).");
    process.exitCode = ok ? 0 : 2;
  } else {
    await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;
    let underLock = 0;
    try {
      underLock = await applied(); // relu APRÈS obtention du verrou (une autre exécution a pu migrer entre-temps)
      await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    } finally {
      await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`;
    }
    const after = await applied();
    console.log(after === underLock ? `Rien à appliquer : base déjà à jour (${after}/${expected.length}) ✔` : `Migrations appliquées ✔ (${underLock} → ${after}/${expected.length})`);
    if (!(await verifyGuards())) {
      console.error("Garde-fous manquants après migration ✘");
      process.exitCode = 2;
    }
  }
} catch (e) {
  console.error("Échec des migrations :", (e as Error).message, (e as { cause?: Error }).cause?.message ?? "");
  process.exitCode = 1;
} finally {
  await sql.end();
}
