import { z } from "zod";
import { getDb } from "@/db/client";
import { analyticsEvents } from "@/db/schema";
import { clientIp, hashIp, rateLimit } from "@/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Analytique d'entonnoir respectueuse de la vie privée : pas de cookie, pas d'IP stockée,
 * identifiant de session aléatoire (sessionStorage), noms d'événements en liste blanche.
 * « request_submitted » n'est JAMAIS accepté ici : il est écrit par le serveur après COMMIT.
 */
const PUBLIC_EVENTS = ["view_service", "start_estimator", "estimate_shown", "start_request"] as const;
const schema = z.object({
  name: z.enum(PUBLIC_EVENTS),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  path: z.string().max(200).optional(),
  service: z.enum(["chauffage", "climatisation"]).optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(150).optional(),
});

export async function POST(req: Request) {
  try {
    const text = await req.text();
    if (text.length > 2000) return new Response(null, { status: 413 });
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) return new Response(null, { status: 422 });
    const db = getDb();
    if (!(await rateLimit(db, `evt:${hashIp(clientIp(req.headers))}`, 200, 600))) return new Response(null, { status: 429 });
    await db.insert(analyticsEvents).values({ ...parsed.data, path: parsed.data.path?.split("?")[0] });
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 }); // l'analytique ne doit jamais casser la navigation
  }
}
