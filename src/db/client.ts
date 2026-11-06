import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

type Holder = { sql?: postgres.Sql; db?: Db; url?: string };
const g = globalThis as unknown as { __rcDb?: Holder };
g.__rcDb ??= {};

export class DatabaseUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Base de données indisponible");
    this.name = "DatabaseUnavailableError";
    this.cause = cause;
  }
}

function sslOption(url: string): postgres.Options<Record<string, never>>["ssl"] {
  const mode = process.env.DATABASE_SSL ?? "auto";
  if (mode === "disable") return false;
  if (mode === "require") return "require";
  return /localhost|127\.0\.0\.1/.test(url) ? false : "require";
}

export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseUnavailableError(new Error("DATABASE_URL manquant"));
  const h = g.__rcDb!;
  if (!h.db || h.url !== url) {
    h.sql = postgres(url, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT ?? 8),
      prepare: false, // compatible pooler Supabase (mode transaction)
      ssl: sslOption(url),
      onnotice: () => {},
    });
    h.db = drizzle(h.sql, { schema });
    h.url = url;
  }
  return h.db;
}

export async function closeDb() {
  const h = g.__rcDb!;
  await h.sql?.end({ timeout: 2 });
  h.sql = undefined;
  h.db = undefined;
  h.url = undefined;
}

/** Détecte les erreurs de connexion pour renvoyer un 503 explicite (jamais de faux succès). */
export function isConnectionError(e: unknown): boolean {
  if (e instanceof DatabaseUnavailableError) return true;
  const err = e as { code?: string; message?: string; cause?: unknown };
  const code = err?.code ?? "";
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "CONNECT_TIMEOUT", "EAI_AGAIN", "57P01", "57P03", "53300", "08006", "08001", "08004"].includes(code))
    return true;
  if (err?.cause && err.cause !== e) return isConnectionError(err.cause);
  return /connect|ECONNREFUSED|terminat/i.test(err?.message ?? "");
}
