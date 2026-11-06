import "server-only";
import { effectiveSiteMode, env } from "./env";

/** Informations publiques affichables (jamais de secret). Les champs vides ne sont pas affichés. */
export function publicSiteInfo() {
  const e = env();
  return {
    brand: e.BRAND_NAME,
    appUrl: e.APP_URL,
    mode: effectiveSiteMode(e),
    requestedMode: e.SITE_MODE,
    phone: e.PUBLIC_PHONE || null,
    email: e.LEGAL_EMAIL || null,
    turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null,
  };
}
