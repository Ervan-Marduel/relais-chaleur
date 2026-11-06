import { after } from "next/server";
import { getDb, isConnectionError } from "@/db/client";
import { requestPayloadSchema } from "@/lib/validation/request";
import { createPreorder } from "@/server/preorders";
import { processDueNotifications } from "@/server/notifications";
import { clientIp, hashIp, rateLimit, sameOrigin, verifyTurnstile } from "@/server/security";
import { BodyTooLarge, json, jsonError, readJsonBody } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DB_DOWN_MESSAGE =
  "Votre demande n'a pas pu être enregistrée (service momentanément indisponible). Vos informations sont conservées sur cet appareil : réessayez dans quelques instants.";

export async function POST(req: Request) {
  if (!sameOrigin(req.headers)) return jsonError(403, "origin", "Origine de la requête refusée.");

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    if (e instanceof BodyTooLarge) return jsonError(413, "too_large", "Demande trop volumineuse.");
    return jsonError(400, "invalid_json", "Format de demande invalide.");
  }

  const parsed = requestPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, "validation", "Certains champs sont à corriger.", {
      issues: parsed.error.issues.slice(0, 30).map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const p = parsed.data;

  // Anti-spam : honeypot, délai minimal de saisie, Turnstile (si configuré), limitation de débit.
  if (p.website && p.website.trim() !== "") return jsonError(400, "rejected", "Demande refusée.");
  if (p.startedAt && Date.now() - p.startedAt < Number(process.env.MIN_FILL_MS ?? 4000)) return jsonError(400, "too_fast", "Envoi trop rapide, merci de réessayer.");
  const ip = clientIp(req.headers);
  if (!(await verifyTurnstile(p.turnstileToken, ip))) return jsonError(400, "captcha", "Vérification anti-robot échouée, merci de réessayer.");

  try {
    const db = getDb();
    const allowed = await rateLimit(db, `req:${hashIp(ip)}`, Number(process.env.RATE_LIMIT_REQUESTS ?? 8), 600);
    if (!allowed) return jsonError(429, "rate_limited", "Trop de demandes depuis cette connexion. Réessayez dans quelques minutes.");

    const result = await createPreorder(db, p);
    // Envoi des emails APRÈS la réponse : l'enregistrement est déjà commité ; en cas d'échec,
    // les notifications restent en file et seront retentées (cron + admin).
    after(async () => {
      try {
        await processDueNotifications(db, { requestId: result.id });
      } catch (e) {
        console.error("[notifications] traitement différé impossible :", (e as Error).message);
      }
    });
    return json({ ok: true, reference: result.reference, quoteMode: result.quoteMode, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
  } catch (e) {
    if (isConnectionError(e)) {
      console.error("[preorder] base indisponible");
      return jsonError(503, "db_unavailable", DB_DOWN_MESSAGE);
    }
    console.error("[preorder] erreur inattendue :", (e as Error).name, (e as Error).message?.slice(0, 200));
    return jsonError(500, "server_error", "Votre demande n'a pas pu être enregistrée. Vos informations sont conservées : réessayez ou contactez-nous.");
  }
}
