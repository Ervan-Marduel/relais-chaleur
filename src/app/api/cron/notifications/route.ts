import { getDb } from "@/db/client";
import { processDueNotifications } from "@/server/notifications";
import { env } from "@/server/env";
import { safeEqual } from "@/server/security";
import { json, jsonError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tâche planifiée Vercel (vercel.json) : relance les notifications en échec. Protégée par CRON_SECRET. */
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return jsonError(401, "unauthorized", "Non autorisé.");
  const results = await processDueNotifications(getDb(), { limit: 50 });
  return json({ ok: true, processed: results.length, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
}
