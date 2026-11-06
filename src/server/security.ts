import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { env } from "./env";

export function sha256(s: string | Buffer) {
  return createHash("sha256").update(s).digest("hex");
}

/** Hash salé de l'IP : jamais d'IP en clair en base ni dans les logs. */
export function hashIp(ip: string | null | undefined) {
  const salt = env().HASH_SALT ?? env().SESSION_SECRET ?? "dev-salt";
  return createHmac("sha256", salt).update(ip ?? "unknown").digest("hex").slice(0, 32);
}

export function clientIp(headers: Headers) {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Limitation de débit à fenêtre fixe, stockée en base (pas de service tiers).
 * Retourne true si la requête est autorisée.
 */
export async function rateLimit(db: Db, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE rate_limits.window_start END
    RETURNING count`);
  return Number(rows[0]?.count ?? 1) <= limit;
}

/** Vérification d'origine pour les POST publics (complément SameSite). */
export function sameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin) return headers.get("sec-fetch-site") === "same-origin";
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<boolean> {
  const secret = env().TURNSTILE_SECRET_KEY;
  if (!secret) return true; // non configuré (préproduction) : honeypot + délai + rate limit restent actifs
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { success?: boolean; hostname?: string; action?: string };
    if (j.success !== true) return false;
    // Le jeton doit avoir été émis pour NOTRE domaine et pour l'action « preorder » (anti-rejeu depuis un autre site).
    const expectedHost = new URL(env().APP_URL).hostname;
    if (!["localhost", "127.0.0.1"].includes(expectedHost) && j.hostname !== expectedHost) return false;
    // Action OBLIGATOIRE (P1-A) : un jeton sans action ou d'un autre formulaire est refusé.
    // Usage unique : Cloudflare renvoie success=false (« timeout-or-duplicate ») pour un jeton déjà vérifié.
    if (j.action !== "preorder") return false;
    return true;
  } catch {
    return false;
  }
}
