import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { accessDecision, effectiveModeFrom, readinessFrom } from "@/lib/site-mode";
import { proxy } from "@/proxy";
import { verifyTurnstile } from "@/server/security";

const COMPLETE = {
  SITE_MODE: "production", APP_URL: "https://relais-chaleur.example", DATABASE_URL: "postgres://x", EMAIL_DRIVER: "resend",
  RESEND_API_KEY: "k", EMAIL_FROM: "a@b.fr", TEAM_NOTIFICATION_EMAIL: "t@b.fr", SESSION_SECRET: "s".repeat(40), CRON_SECRET: "c".repeat(20),
  TURNSTILE_SECRET_KEY: "t", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "p", FILE_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  LEGAL_COMPANY_NAME: "X SAS", LEGAL_FORM: "SAS", LEGAL_SIREN: "123", LEGAL_ADDRESS: "Lyon", LEGAL_EMAIL: "c@x.fr", LEGAL_PUBLICATION_DIRECTOR: "Y",
  LEGAL_INSURANCE: "Z", LEGAL_TEXTS_VALIDATED: "true",
};
const basic = (pw: string) => "Basic " + Buffer.from(`preview:${pw}`).toString("base64");

describe("P0-C — fermeture de la pré-production", () => {
  it("cas de l'audit : SITE_MODE=production + LEGAL_TEXTS_VALIDATED=false + PREVIEW_PASSWORD ⇒ 401 sans authentification", async () => {
    const env = { ...COMPLETE, LEGAL_TEXTS_VALIDATED: "false", PREVIEW_PASSWORD: "secret-preprod" };
    expect(accessDecision(env, "/", null)).toEqual({ action: "auth" });
    expect(accessDecision(env, "/demande", basic("mauvais"))).toEqual({ action: "auth" });
    expect(accessDecision(env, "/demande", basic("secret-preprod"))).toEqual({ action: "allow" });
    expect(effectiveModeFrom(env)).toBe("preproduction");
    // via le vrai proxy Next.js
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      const res = proxy(new NextRequest("https://relais-chaleur.example/"));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toMatch(/Basic/);
      const ok = proxy(new NextRequest("https://relais-chaleur.example/", { headers: { authorization: basic("secret-preprod") } }));
      expect(ok.status).toBe(200);
    } finally {
      process.env = saved;
    }
  });

  it("le mot de passe est exigé même si toute la checklist est verte, et sa présence empêche le mode production effectif", () => {
    const env = { ...COMPLETE, PREVIEW_PASSWORD: "secret-preprod" };
    expect(accessDecision(env, "/admin", null)).toEqual({ action: "auth" });
    expect(effectiveModeFrom(env)).toBe("preproduction");
    expect(readinessFrom(env).find((i) => i.label.includes("PREVIEW_PASSWORD"))?.ok).toBe(false);
  });

  it("SITE_MODE=production + checklist incomplète + pas de mot de passe ⇒ site public fermé (503), admin joignable", () => {
    const env = { ...COMPLETE, LEGAL_TEXTS_VALIDATED: "false" };
    expect(accessDecision(env, "/", null)).toEqual({ action: "closed" });
    expect(accessDecision(env, "/api/requests", null)).toEqual({ action: "closed" });
    expect(accessDecision(env, "/admin/login", null)).toEqual({ action: "allow" });
  });

  it("ouverture commerciale effective seulement si tout est vert et le mot de passe retiré ; le cron reste joignable", () => {
    expect(effectiveModeFrom(COMPLETE)).toBe("production");
    expect(accessDecision(COMPLETE, "/", null)).toEqual({ action: "allow" });
    expect(accessDecision({ ...COMPLETE, PREVIEW_PASSWORD: "x" }, "/api/cron/notifications", null)).toEqual({ action: "allow" });
    expect(accessDecision({ SITE_MODE: "preproduction" }, "/", null)).toEqual({ action: "allow" });
  });
});

describe("P1-A — Turnstile : action obligatoire, hôte vérifié", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TURNSTILE_SECRET_KEY;
  });
  const withResponse = (body: Record<string, unknown>) => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    process.env.APP_URL = "https://relais-chaleur.example";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body))));
  };
  it("accepte uniquement success + bon hôte + action « preorder »", async () => {
    withResponse({ success: true, hostname: "relais-chaleur.example", action: "preorder" });
    expect(await verifyTurnstile("tok", "1.2.3.4")).toBe(true);
  });
  it("refuse une réponse sans action", async () => {
    withResponse({ success: true, hostname: "relais-chaleur.example" });
    expect(await verifyTurnstile("tok", null)).toBe(false);
  });
  it("refuse une mauvaise action", async () => {
    withResponse({ success: true, hostname: "relais-chaleur.example", action: "login" });
    expect(await verifyTurnstile("tok", null)).toBe(false);
  });
  it("refuse un autre nom d'hôte", async () => {
    withResponse({ success: true, hostname: "site-pirate.example", action: "preorder" });
    expect(await verifyTurnstile("tok", null)).toBe(false);
  });
  it("refuse un jeton déjà utilisé (Cloudflare : timeout-or-duplicate) et l'absence de jeton", async () => {
    withResponse({ success: false, "error-codes": ["timeout-or-duplicate"] });
    expect(await verifyTurnstile("tok", null)).toBe(false);
    expect(await verifyTurnstile(undefined, null)).toBe(false);
  });
});
