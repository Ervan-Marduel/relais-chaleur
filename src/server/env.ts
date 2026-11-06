import "server-only";
import { z } from "zod";
import { effectiveModeFrom, readinessFrom, type RawEnv } from "@/lib/site-mode";

/**
 * Variables d'environnement SERVEUR. Aucune n'est exposée au navigateur
 * (seules les variables NEXT_PUBLIC_* le sont — on n'y met jamais de secret).
 */
const schema = z.object({
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z.enum(["require", "disable", "auto"]).default("auto"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SITE_MODE: z.enum(["preproduction", "production"]).default("preproduction"),
  PREVIEW_PASSWORD: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  ADMIN_SETUP_TOKEN: z.string().optional(),
  FILE_ENCRYPTION_KEY: z.string().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  EMAIL_DRIVER: z.enum(["resend", "file", "fail", "disabled"]).default("file"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  TEAM_NOTIFICATION_EMAIL: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  HASH_SALT: z.string().optional(),
  // Identité légale — obligatoire avant ouverture commerciale
  LEGAL_COMPANY_NAME: z.string().optional(),
  LEGAL_FORM: z.string().optional(),
  LEGAL_SIREN: z.string().optional(),
  LEGAL_RCS: z.string().optional(),
  LEGAL_ADDRESS: z.string().optional(),
  LEGAL_EMAIL: z.string().optional(),
  LEGAL_PHONE: z.string().optional(),
  LEGAL_PUBLICATION_DIRECTOR: z.string().optional(),
  LEGAL_VAT_NUMBER: z.string().optional(),
  LEGAL_HOST: z.string().default("Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis"),
  LEGAL_INSURANCE: z.string().optional(),
  LEGAL_TEXTS_VALIDATED: z.enum(["true", "false"]).default("false"),
  PUBLIC_PHONE: z.string().optional(),
  BRAND_NAME: z.string().default("Relais Chaleur Lyon"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;
export function env(): Env {
  if (!cached || process.env.NODE_ENV === "test") cached = schema.parse(process.env);
  return cached;
}

export { LEGAL_REQUIRED } from "@/lib/site-mode";
export type { ReadinessItem } from "@/lib/site-mode";

/** Liste de contrôle d'ouverture : le mode production n'est EFFECTIF que si tout est vert (calcul partagé avec le proxy). */
export function launchReadiness(e: Env = env()) {
  return readinessFrom(e as unknown as RawEnv);
}

/** Une pré-production accessible publiquement en HTTPS sans mot de passe peut recevoir de vraies données clients. */
export function publicPreproductionRisk(e: Env = env()): boolean {
  return effectiveSiteMode(e) === "preproduction" && e.APP_URL.startsWith("https://") && !e.PREVIEW_PASSWORD;
}

/** Mode effectif : « production » seulement si demandé ET toutes les conditions remplies. */
export function effectiveSiteMode(e: Env = env()): "production" | "preproduction" {
  return effectiveModeFrom(e as unknown as RawEnv);
}
