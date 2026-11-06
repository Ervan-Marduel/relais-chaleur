import { expect, test } from "@playwright/test";
import { noHorizontalOverflow, shot } from "./helpers";

const PAGES = ["/", "/chauffage", "/climatisation", "/professionnels", "/demande", "/mentions-legales", "/confidentialite", "/conditions"];

test.describe("site public", () => {
  for (const path of PAGES) {
    test(`page ${path} : chargement, pas de débordement, pas de fausse promesse`, async ({ page }, info) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1").first()).toBeVisible();
      await noHorizontalOverflow(page);
      const text = (await page.locator("body").innerText()).toLowerCase();
      expect(text).not.toContain("réservation confirmée");
      expect(text).not.toMatch(/payer maintenant|paiement en ligne|carte bancaire/);
      expect(text).not.toMatch(/livraison en 2 ?h garantie/);
      if (["/", "/chauffage", "/climatisation", "/professionnels", "/demande"].includes(path)) await shot(page, `public${path === "/" ? "-accueil" : path.replace(/\//g, "-")}`, info.project.name);
    });
  }

  test("accueil : deux choix clairs et CTA vers le simulateur", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /J'ai besoin de chauffage/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /J'ai besoin de climatisation/ })).toBeVisible();
    await page.getByRole("link", { name: /J'ai besoin de chauffage/ }).click();
    await expect(page).toHaveURL(/\/chauffage$/);
    await expect(page.getByText("88,00 €").first()).toBeVisible(); // grille servie par la base
  });

  test("chauffage : simulateur immédiat sur la page", async ({ page }) => {
    await page.goto("/chauffage");
    const est = page.locator(".panel").first();
    await est.getByLabel("Surface totale (m²)").fill("25");
    await est.getByLabel("Isolation").selectOption("bonne");
    await expect(est.getByText(/1 radiateur de 2000 W/)).toBeVisible();
  });

  test("climatisation : sur devis, aucun prix affiché", async ({ page }) => {
    await page.goto("/climatisation");
    const t = await page.locator("main").innerText();
    expect(t).toContain("sur devis");
    expect(t).not.toMatch(/\d+,\d{2} €/);
  });

  test("pré-production : non indexé", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/Disallow: \//);
  });

  test("pages légales : modèles marqués non publiables tant que l'identité manque", async ({ page }) => {
    await page.goto("/mentions-legales");
    await expect(page.getByText(/Modèle non publiable/)).toBeVisible();
    await expect(page.getByText(/À COMPLÉTER/).first()).toBeVisible();
  });
});
