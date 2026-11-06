import { NextResponse, type NextRequest } from "next/server";
import { accessDecision } from "@/lib/site-mode";

/**
 * Contrôle d'accès global (P0-C), calculé par la même fonction que le mode affiché dans l'application.
 * - PREVIEW_PASSWORD présent ⇒ HTTP Basic exigé partout, même si SITE_MODE=production.
 * - SITE_MODE=production avec checklist incomplète ⇒ pages publiques fermées (503) ; /admin reste joignable.
 */
export function proxy(req: NextRequest) {
  const d = accessDecision(process.env, req.nextUrl.pathname, req.headers.get("authorization"));
  if (d.action === "allow") return NextResponse.next();
  if (d.action === "auth") {
    return new NextResponse("Pré-production — accès restreint", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Pre-production", charset="UTF-8"', "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  }
  return new NextResponse(
    "<!doctype html><html lang=fr><meta charset=utf-8><title>Ouverture en préparation</title><body style=\"font-family:system-ui;padding:40px\"><h1>Site en préparation</h1><p>L'ouverture commerciale n'est pas encore autorisée (vérifications légales et techniques en cours).</p></body></html>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "86400", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}

export const config = { matcher: ["/((?!_next/static|_next/image|icon.svg).*)"] };
