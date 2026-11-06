import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "@/db/client";
import { ensureDefaultSettings } from "@/server/settings-store";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://rc@127.0.0.1:54329/rc_test";

/** Recrée un schéma vierge, applique les migrations et la version 1 des paramètres. */
export async function resetTestDb() {
  await closeDb();
  const sql = postgres(TEST_DB_URL, { max: 1, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql.end();
  process.env.DATABASE_URL = TEST_DB_URL;
  const db = getDb();
  await ensureDefaultSettings(db);
  return db;
}
