/**
 * Calcul UNIQUE du mode effectif du site — sans dépendance serveur, utilisé à la fois par le proxy
 * (contrôle d'accès) et par l'application (bannière, indexation, checklist).
 *
 * Règles (P0-C) :
 *  1. PREVIEW_PASSWORD défini  ⇒ authentification exigée sur tout le site, QUEL QUE SOIT SITE_MODE.
 *     On ne le retire qu'au moment de l'ouverture commerciale (et sa présence empêche le mode production effectif).
 *  2. SITE_MODE=production mais checklist incomplète ⇒ pages publiques fermées (503), admin accessible.
 *  3. Sinon : accès normal (pré-production ouverte ou production effective).
 */
export type RawEnv = Record<string, string | undefined>;
export type ReadinessItem = { label: string; ok: boolean; detail?: string };

export const LEGAL_REQUIRED = [
  { key: "LEGAL_COMPANY_NAME", label: "Raison sociale / nom de l'exploitant" },
  { key: "LEGAL_FORM", label: "Forme juridique (SAS, EI…)" },
  { key: "LEGAL_SIREN", label: "SIREN / SIRET" },
  { key: "LEGAL_ADDRESS", label: "Adresse du siège" },
  { key: "LEGAL_EMAIL", label: "Email de contact" },
  { key: "LEGAL_PUBLICATION_DIRECTOR", label: "Directeur de la publication" },
  { key: "LEGAL_INSURANCE", label: "Assureur responsabilité civile / location" },
] as const;

export function readinessFrom(e: RawEnv): ReadinessItem[] {
  const appUrl = e.APP_URL ?? "http://localhost:3000";
  const key = e.FILE_ENCRYPTION_KEY ? Buffer.from(e.FILE_ENCRYPTION_KEY, "base64") : null;
  const items: ReadinessItem[] = LEGAL_REQUIRED.map((r) => ({ label: r.label, ok: !!e[r.key] }));
  items.push({ label: "Textes juridiques (CGL B2B/B2C, confidentialité) relus et validés", ok: e.LEGAL_TEXTS_VALIDATED === "true" });
  items.push({ label: "Base de données configurée", ok: !!e.DATABASE_URL });
  items.push({ label: "Emails transactionnels (Resend) configurés", ok: e.EMAIL_DRIVER === "resend" && !!e.RESEND_API_KEY && !!e.EMAIL_FROM && !!e.TEAM_NOTIFICATION_EMAIL });
  items.push({ label: "Secret de session défini (≥ 32 caractères)", ok: (e.SESSION_SECRET?.length ?? 0) >= 32 });
  items.push({ label: "Secret de tâche planifiée (CRON_SECRET)", ok: (e.CRON_SECRET?.length ?? 0) >= 16 });
  items.push({ label: "Anti-spam Turnstile configuré", ok: !!e.TURNSTILE_SECRET_KEY && !!e.NEXT_PUBLIC_TURNSTILE_SITE_KEY });
  items.push({ label: "Chiffrement des scans et photos (FILE_ENCRYPTION_KEY, 32 octets)", ok: key?.length === 32 });
  items.push({ label: "URL publique en HTTPS", ok: appUrl.startsWith("https://") });
  items.push({ label: "Mot de passe de pré-production (PREVIEW_PASSWORD) retiré", ok: !e.PREVIEW_PASSWORD, detail: "à retirer uniquement le jour de l'ouverture" });
  return items;
}

export function effectiveModeFrom(e: RawEnv): "production" | "preproduction" {
  if (e.SITE_MODE !== "production") return "preproduction";
  return readinessFrom(e).every((i) => i.ok) ? "production" : "preproduction";
}

export type AccessDecision = { action: "allow" } | { action: "auth" } | { action: "closed" };

/** Décision d'accès pour une requête (utilisée par src/proxy.ts). */
export function accessDecision(e: RawEnv, pathname: string, authorization: string | null): AccessDecision {
  if (pathname.startsWith("/api/cron/")) return { action: "allow" }; // protégé par CRON_SECRET
  const pw = e.PREVIEW_PASSWORD;
  if (pw) {
    if (authorization?.startsWith("Basic ")) {
      try {
        const decoded = atob(authorization.slice(6));
        const pass = decoded.slice(decoded.indexOf(":") + 1);
        if (pass.length === pw.length && timingSafeEqualStr(pass, pw)) return { action: "allow" };
      } catch { /* en-tête invalide */ }
    }
    return { action: "auth" };
  }
  if (e.SITE_MODE === "production" && effectiveModeFrom(e) !== "production") {
    const adminPath = pathname.startsWith("/admin") || pathname.startsWith("/api/admin") || pathname.startsWith("/_next/");
    return adminPath ? { action: "allow" } : { action: "closed" };
  }
  return { action: "allow" };
}

function timingSafeEqualStr(a: string, b: string) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
