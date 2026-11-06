import { expect, test } from "@playwright/test";
import { LOCKED_ENV } from "../../playwright.config";

/**
 * P0-C sur un VRAI serveur de production : SITE_MODE=production, LEGAL_TEXTS_VALIDATED=false, PREVIEW_PASSWORD défini.
 * Un visiteur sans authentification (navigateur privé, sans cookie) doit recevoir 401 partout.
 */
test("pré-production verrouillée malgré SITE_MODE=production : 401 sans mot de passe", async ({ browser, request }) => {
  for (const path of ["/", "/chauffage", "/demande", "/admin/login", "/api/admin/export", "/robots.txt"]) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect(r.status(), path).toBe(401);
  }
  expect((await request.post("/api/requests", { data: {} })).status()).toBe(401);
  // navigateur privé, mauvais mot de passe
  const bad = await browser.newContext({ httpCredentials: { username: "x", password: "mauvais" } });
  expect((await (await bad.newPage()).goto("/"))?.status()).toBe(401);
  await bad.close();
});

test("avec le mot de passe : accès, bandeau pré-production et non-indexation", async ({ browser }, info) => {
  const ctx = await browser.newContext({ httpCredentials: { username: "preview", password: LOCKED_ENV.PREVIEW_PASSWORD } });
  const page = await ctx.newPage();
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.getByText(/pré-production/i).first()).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await page.screenshot({ path: `docs/captures/preprod-verrouillee-${info.project.name}.png` });
  await ctx.close();
});

test("la tâche planifiée reste joignable (protégée par son propre secret)", async ({ request }) => {
  expect((await request.get("/api/cron/notifications")).status()).toBe(401); // 401 du cron (CRON_SECRET), pas du proxy
  expect((await request.get("/api/cron/notifications", { headers: { Authorization: `Bearer ${LOCKED_ENV.CRON_SECRET}` } })).status()).toBe(200);
});
