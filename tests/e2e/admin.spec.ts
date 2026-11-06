import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { datesAndZone, next, shot } from "./helpers";
import { E2E_ENV } from "../../playwright.config";

test.describe.configure({ mode: "serial" });

let reference = "";

async function loginAdmin(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(E2E_ENV.DEMO_ADMIN_EMAIL);
  await page.getByLabel("Mot de passe").fill(E2E_ENV.DEMO_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
}

test("recette 13 : sans authentification, aucune donnée client ni document n'est accessible", async ({ page, request }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/admin/demandes");
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect((await request.get("/api/admin/export")).status()).toBe(401);
  expect((await request.get("/api/admin/documents/00000000-0000-0000-0000-000000000000")).status()).toBe(401);
  // mauvais mot de passe
  await page.getByLabel("Email").fill(E2E_ENV.DEMO_ADMIN_EMAIL);
  await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.locator(".notice[role=alert]")).toContainText("Identifiants incorrects");
  // page d'installation désactivée quand un admin existe
  await page.goto("/admin/setup");
  await expect(page.getByText(/Un administrateur existe déjà/)).toBeVisible();
  // le cron exige son secret
  expect((await request.get("/api/cron/notifications")).status()).toBe(401);
  expect((await request.get("/api/cron/notifications", { headers: { Authorization: `Bearer ${E2E_ENV.CRON_SECRET}` } })).status()).toBe(200);
});

test("recette 13 bis : aucune clé serveur dans le bundle public", async () => {
  const secrets = [E2E_ENV.SESSION_SECRET, E2E_ENV.CRON_SECRET, E2E_ENV.HASH_SALT, E2E_ENV.ADMIN_SETUP_TOKEN, "postgres://", "DATABASE_URL", "RESEND_API_KEY", E2E_ENV.DEMO_ADMIN_PASSWORD];
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = walk(".next/static").filter((f) => /\.(js|css|html|json)$/.test(f));
  expect(files.length).toBeGreaterThan(5);
  for (const f of files) {
    const c = readFileSync(f, "utf8");
    for (const s of secrets) expect(c.includes(s), `${s} trouvé dans ${f}`).toBe(false);
  }
});

test("recette 2 : un professionnel commande pour une autre adresse et un autre réceptionnaire (5 × 14 j = 559 € HT / 670,80 € TTC)", async ({ page }, info) => {
  await page.goto("/demande?service=chauffage");
  await next(page);
  await page.getByLabel(/Pièce par pièce/).check();
  await page.getByLabel("Pièce 1", { exact: true }).fill("20");
  await page.getByLabel("Pièce 2", { exact: true }).fill("20");
  for (const i of [3, 4, 5]) {
    await page.getByRole("button", { name: "+ Ajouter une pièce" }).click();
    await page.getByLabel(`Pièce ${i}`, { exact: true }).fill("20");
  }
  await page.getByLabel(/^Bonne/).check();
  await next(page);
  await page.getByLabel("Type de lieu").selectOption("copropriete");
  await page.getByLabel(/Étage/).fill("2");
  await page.getByLabel("Ascenseur").selectOption("non");
  await next(page);
  await expect(page.locator(".result-big")).toHaveText(/5 appareils/);
  await next(page);
  await datesAndZone(page, { days: "14", postalCode: "69100" });
  await expect(page.getByText("559,00 €").first()).toBeVisible();
  await expect(page.getByText("670,80 €")).toBeVisible();
  await next(page);
  await page.getByLabel("Vous êtes").selectOption("syndic");
  await expect(page.getByLabel(/SIRET/)).toBeVisible();
  await page.getByLabel("Raison sociale").fill("Syndic E2E Gestion");
  await page.getByLabel(/SIRET/).fill("732 829 320 00074");
  await page.getByLabel("Nom du contact").fill("Diane Donneuse");
  await page.getByLabel("Téléphone", { exact: true }).fill("04 72 00 00 01");
  await page.getByLabel("Email").fill("diane@e2e.invalid");
  await page.getByLabel(/Votre référence interne/).fill("OS-E2E-42");
  await page.getByLabel("Nom du réceptionnaire").fill("Rémi Réceptionnaire");
  await page.getByLabel("Téléphone du réceptionnaire").fill("07 00 00 00 02");
  await page.getByLabel("Numéro et rue").fill("42 avenue du Test");
  await page.getByLabel(/Bâtiment/).fill("Bât. C");
  await page.getByLabel("Commune").fill("Villeurbanne");
  await page.getByLabel(/Instructions d'accès/).fill("Gardien loge RDC");
  await next(page);
  await page.getByLabel(/demande sans paiement/).check();
  await page.getByLabel(/politique de confidentialité/).check();
  await page.getByRole("button", { name: "Envoyer ma demande" }).click();
  await expect(page.locator(".ref")).toHaveText(/^RC-/);
  reference = (await page.locator(".ref").textContent())!;
  await shot(page, "pro-succes", info.project.name);
});

test("recettes 5, 7, 8, 10 : la demande apparaît dans l'admin, qualification, devis, confirmation, affectation, bon PDF", async ({ page }, info) => {
  expect(reference).toMatch(/^RC-/);
  await loginAdmin(page);
  await shot(page, "admin-tableau-de-bord", info.project.name);
  await page.goto(`/admin/demandes?q=${reference}`);
  await shot(page, "admin-liste", info.project.name);
  await page.getByRole("link", { name: reference }).click();
  await expect(page.getByRole("heading", { name: new RegExp(reference) })).toBeVisible();
  // donneur d'ordre et réceptionnaire distincts
  const client = page.locator("section", { has: page.getByRole("heading", { name: "Donneur d'ordre" }) });
  const site = page.locator("section", { has: page.getByRole("heading", { name: /Lieu de livraison/ }) });
  await expect(client).toContainText("Syndic E2E Gestion");
  await expect(client).toContainText("73282932000074");
  await expect(client).toContainText("Diane Donneuse");
  await expect(site).toContainText("Rémi Réceptionnaire");
  await expect(site).toContainText("42 avenue du Test");
  await expect(page.getByText("559,00 € HT").first()).toBeVisible();
  // notifications envoyées (accusé + équipe)
  const notifs = page.locator("section", { has: page.getByRole("heading", { name: "Notifications" }) });
  await expect(notifs).toContainText("Accusé client : sent");
  await expect(notifs).toContainText("Alerte équipe : sent");
  await expect(page.getByRole("link", { name: /Appeler le donneur/ })).toHaveAttribute("href", /^tel:/);

  // appel noté
  await page.getByLabel("Contenu").fill("Appel : panne chaufferie, 5 logements, tableau à vérifier.");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByText("Note enregistrée.")).toBeVisible();
  // qualification
  await page.getByLabel("Nouveau statut").selectOption("a_qualifier");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByText("Statut mis à jour.")).toBeVisible();
  // confirmation refusée sans devis ni créneau ni contrôles
  // devis (prérempli depuis l'estimation)
  await page.getByText("Créer une nouvelle version de devis").click();
  await page.getByRole("button", { name: "Enregistrer le devis" }).click();
  await expect(page.getByText(/Devis v1 enregistré/)).toBeVisible();
  await page.getByLabel("Nouveau statut").selectOption("devis_a_confirmer");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByText("Statut mis à jour.")).toBeVisible();
  await page.getByRole("button", { name: "Confirmer après contrôle" }).click();
  await expect(page.locator(".notice[role=alert]")).toContainText(/contrôles humains/);
  // planning + modèle
  const d = new Date(Date.now() + 12 * 86400_000);
  const iso = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  await page.getByLabel("Livraison confirmée — date").fill(iso(d));
  await page.getByLabel("Heure").first().fill("09:00");
  await page.getByLabel("Créneau annoncé").fill("9h–11h");
  await page.getByLabel("Reprise prévue — date").fill(iso(new Date(d.getTime() + 14 * 86400_000)));
  await page.getByLabel("Modèle de matériel retenu").selectOption({ label: "VARMA Ingaro (244177) — réf. non vérifiée" });
  await page.getByLabel("Note technique et électrique").fill("5 logements, 1 appareil/logement, circuits à vérifier par l'électricien du syndic.");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Planning et informations enregistrés.")).toBeVisible();
  // confirmation après contrôles
  for (const l of [/Stock physiquement vérifié/, /Zone de livraison/, /Capacité électrique discutée/, /Devis \/ prix communiqué/, /Créneau de livraison convenu/]) await page.getByLabel(l).check();
  await page.getByRole("button", { name: "Confirmer après contrôle" }).click();
  await expect(page.getByText("Statut mis à jour.")).toBeVisible();
  await expect(page.locator("h1 .badge")).toHaveText("Confirmée");
  // affectation de 5 appareils (RC-001…RC-005)
  for (const c of ["RC-001", "RC-002", "RC-003", "RC-004", "RC-005"]) await page.getByLabel(new RegExp(`^${c}`)).check();
  await page.getByRole("button", { name: "Affecter la sélection" }).click();
  await expect(page.getByText("5 appareil(s) affecté(s).")).toBeVisible();
  await page.getByLabel("Nouveau statut").selectOption("preparation");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.locator("h1 .badge")).toHaveText("En préparation");
  // bon PDF
  await page.getByRole("button", { name: "Générer le bon de remise / reprise" }).click();
  await expect(page.getByText(/Bon BR-\d{4}-\d{6} v1 généré et archivé/)).toBeVisible();
  await shot(page, "admin-fiche-demande", info.project.name);
  const link = page.getByRole("link", { name: /BR-\d{4}-\d{6} — version 1/ });
  const href = (await link.getAttribute("href"))!;
  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  const buf = await res.body();
  expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  mkdirSync("docs/captures", { recursive: true });
  writeFileSync("docs/captures/bon-remise-reprise-exemple.pdf", buf);
  const pdfFile = "test-results/e2e-bon.pdf";
  writeFileSync(pdfFile, buf);
  expect(execFileSync("pdfinfo", [pdfFile]).toString()).toMatch(/Pages:\s+1[\s\S]*A4/);
  const text = execFileSync("pdftotext", [pdfFile, "-"]).toString().replace(/\s+/g, " ");
  for (const s of [reference, "Syndic E2E Gestion", "73282932000074", "Diane Donneuse", "Rémi Réceptionnaire", "42 avenue du Test", "Bât. C", "VARMA / Ingaro / 244177", "RC-001, RC-002, RC-003, RC-004, RC-005", "OS-E2E-42", "Lu et approuvé", "Date réelle de remise", "Date réelle de reprise"])
    expect(text, s).toContain(s);
  // Clic réel sur le lien : le navigateur reçoit bien le PDF (téléchargement en mode headless)
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toMatch(/^BR-\d{4}-\d{6}-v1\.pdf$/);
  // le document non authentifié reste inaccessible
  const anon = await page.context().browser()!.newContext();
  expect((await anon.request.get(`${info.project.use.baseURL}${href}`)).status()).toBe(401);
  await anon.close();
});

test("recette 6 : export CSV protégé, aucun paiement / facture dans l'admin", async ({ page }, info) => {
  await loginAdmin(page);
  const res = await page.request.get("/api/admin/export");
  expect(res.status()).toBe(200);
  const csv = await res.text();
  expect(csv).toContain(reference);
  expect(csv.split("\n")[0]).toContain("reference;createdAt;status");
  for (const p of ["/admin/materiel", "/admin/kpi", "/admin/parametres", "/admin/notifications"]) {
    await page.goto(p);
    await expect(page.locator("h1")).toBeVisible();
    await shot(page, `admin${p.replace(/\/admin/, "").replace(/\//g, "-")}`, info.project.name);
  }
  await page.goto("/admin/kpi");
  await expect(page.getByText("Demandes reçues (après enregistrement)")).toBeVisible();
});
