import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { datesAndZone, heatingNeed, inDays, next, shot } from "./helpers";
import { E2E_ENV } from "../../playwright.config";

/**
 * PARCOURS DE RECETTE COMPLET (demandé par l'audit) :
 * particulier → précommande → appel → confirmation → 3 appareils distincts → bon PDF
 * → remise réelle → reprise partielle → reprise complète → parc de nouveau disponible.
 */
test.describe.configure({ mode: "serial" });
let reference = "";
let detailUrl = "";

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(E2E_ENV.DEMO_ADMIN_EMAIL);
  await page.getByLabel("Mot de passe").fill(E2E_ENV.DEMO_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
}
const flash = (page: Page) => page.locator(".flash");

test("1. Un particulier envoie une précommande (3 pièces → 3 radiateurs)", async ({ page }) => {
  await heatingNeed(page, { surface: "60", rooms: "3", insulation: /^Bonne/, place: "maison" });
  await expect(page.locator(".result-big")).toHaveText(/3 appareils/);
  await next(page);
  await datesAndZone(page, { days: "10", postalCode: "69007" });
  await next(page);
  await page.getByLabel("Vous êtes").selectOption("particulier");
  await page.getByLabel("Nom du contact").fill("Rita Recette");
  await page.getByLabel("Téléphone", { exact: true }).fill("06 10 20 30 40");
  await page.getByLabel("Email").fill("rita@e2e.invalid");
  await page.getByLabel("Nom du réceptionnaire").fill("Théo Occupant");
  await page.getByLabel("Téléphone du réceptionnaire").fill("07 10 20 30 40");
  await page.getByLabel("Numéro et rue").fill("7 rue de la Recette");
  await page.getByLabel("Commune").fill("Lyon");
  await next(page);
  await page.getByLabel(/demande sans paiement/).check();
  await page.getByLabel(/politique de confidentialité/).check();
  await page.getByRole("button", { name: "Envoyer ma demande" }).click();
  await expect(page.locator(".ref")).toHaveText(/^RC-/);
  reference = (await page.locator(".ref").textContent())!;
});

test("2-5. Appel, devis, confirmation, 3 appareils distincts, bon PDF", async ({ page }, info) => {
  await login(page);
  await page.goto(`/admin/demandes?q=${reference}`);
  await page.getByRole("link", { name: reference }).click();
  await page.waitForURL(/\/admin\/demandes\/[0-9a-f-]{36}/);
  detailUrl = page.url();
  await page.getByLabel("Contenu").fill("Appel : panne chaudière, 3 pièces, circuits séparés confirmés par l'occupant.");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(flash(page)).toContainText("Note enregistrée");
  await page.getByLabel("Nouveau statut").selectOption("a_qualifier");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.locator("h1 .badge")).toHaveText("À qualifier");
  await page.getByText("Créer une nouvelle version de devis").click();
  await page.getByRole("button", { name: "Enregistrer le devis" }).click();
  await expect(flash(page)).toContainText("Devis v1");
  await page.getByLabel("Nouveau statut").selectOption("devis_a_confirmer");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.locator("h1 .badge")).toHaveText("Devis à confirmer");
  await page.getByLabel("Livraison confirmée — date").fill(inDays(-3));
  await page.getByLabel("Heure").first().fill("09:00");
  await page.getByLabel("Reprise prévue — date").fill(inDays(-2));
  await expect(page.getByLabel(/Quantité confirmée/)).toHaveValue("3");
  await page.getByLabel("Modèle de matériel retenu").selectOption({ label: "VARMA Ingaro (244177) — réf. non vérifiée" });
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(flash(page)).toContainText("Planning et informations enregistrés");
  for (const l of [/Stock physiquement vérifié/, /Zone de livraison/, /Capacité électrique discutée/, /Devis \/ prix communiqué/, /Créneau de livraison convenu/]) await page.getByLabel(l).check();
  await page.getByRole("button", { name: "Confirmer après contrôle" }).click();
  await expect(page.locator("h1 .badge")).toHaveText("Confirmée");
  // RC-009 / RC-010 sont « à contrôler » dans les données de démo : ils ne sont pas proposés
  await expect(page.getByLabel(/^RC-009/)).toHaveCount(0);
  for (const c of ["RC-006", "RC-007", "RC-008"]) await page.getByLabel(new RegExp(`^${c}`)).check();
  await page.getByRole("button", { name: "Affecter la sélection" }).click();
  await expect(flash(page)).toContainText("3 appareil(s) affecté(s)");
  await page.getByLabel("Nouveau statut").selectOption("preparation");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.locator("h1 .badge")).toHaveText("En préparation");
  await page.getByRole("button", { name: "Générer le bon de remise / reprise" }).click();
  await expect(flash(page)).toContainText(/Bon BR-.* généré/);
  const href = (await page.getByRole("link", { name: /BR-\d{4}-\d{6} — version 1/ }).getAttribute("href"))!;
  const pdf = await (await page.request.get(href)).body();
  writeFileSync("test-results/recette-bon.pdf", pdf);
  const text = execFileSync("pdftotext", ["test-results/recette-bon.pdf", "-"]).toString().replace(/\s+/g, " ");
  expect(text).toContain("RC-006, RC-007, RC-008");
  expect(text).toContain("Rita Recette");
  expect(text).toContain("Théo Occupant");
  await shot(page, "recette-avant-remise", info.project.name);
});

const PDF_SCAN = { name: "bon-signe.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% scan du bon signe (test E2E)\n%%EOF\n") };

async function inspectUnit(page: Page, codeRc: string, decision: "bon" | "hors_service", info: { project: { name: string } }, shotName?: string) {
  await page.goto("/admin/materiel#controles");
  const box = page.locator("#controles details", { hasText: codeRc });
  await box.locator("summary").click();
  await box.getByLabel(`Date du contrôle ${codeRc}`).fill(inDays(0));
  await box.getByLabel(`Heure du contrôle ${codeRc}`).fill("00:01");
  await box.getByLabel(`Contrôleur ${codeRc}`).fill("Camille Contrôle");
  for (const l of await box.locator('input[type="checkbox"]').all()) if (decision === "bon") await l.check();
  if (decision === "hors_service") await box.getByLabel(`Anomalies ${codeRc}`).fill("Roulette cassée, boîtier fissuré");
  await box.getByLabel(`Décision ${codeRc}`).selectOption(decision);
  if (shotName) await shot(page, shotName, info.project.name);
  await box.getByRole("button", { name: "Enregistrer le contrôle" }).click();
  await expect(flash(page)).toContainText(`Contrôle enregistré : ${codeRc}`);
}

test("6. Remise PARTIELLE avec refus de signature : incident obligatoire, puis remise du 3e conforme avec scan", async ({ page }, info) => {
  await login(page);
  await page.goto(detailUrl);
  let f = page.locator("#constat-remise");
  await f.getByLabel("Date réelle de remise").fill(inDays(-3));
  await f.getByLabel("Heure réelle (Paris)").fill("09:40");
  await f.getByLabel("Personne qui a remis le matériel").fill("Léo Livreur");
  await f.getByLabel("RC-008").uncheck(); // 2 sur 3 aujourd'hui
  await f.getByLabel(/Si la quantité totale remise diffère/).fill("Troisième pièce fermée à clé, livraison le lendemain");
  await f.getByLabel("Notice Ingaro remise").check();
  await f.getByLabel(/REFUSE de signer/).check();
  // sans motif d'incident : refusé
  await f.getByRole("button", { name: "Enregistrer le constat de remise" }).click();
  await expect(flash(page)).toContainText("Incident : décrivez");
  f = page.locator("#constat-remise");
  await f.getByLabel("Date réelle de remise").fill(inDays(-3));
  await f.getByLabel("Heure réelle (Paris)").fill("09:40");
  await f.getByLabel("Personne qui a remis le matériel").fill("Léo Livreur");
  await f.getByLabel("RC-008").uncheck();
  await f.getByLabel(/Si la quantité totale remise diffère/).fill("Troisième pièce fermée à clé, livraison le lendemain");
  await f.getByLabel("Notice Ingaro remise").check();
  await f.getByLabel(/REFUSE de signer/).check();
  await f.locator("summary", { hasText: "Incident" }).click();
  await f.getByLabel(/Que s'est-il passé/).fill("L'occupant refuse de signer sans l'accord du propriétaire ; mention « refus de signer » portée sur le bon par Léo.");
  await f.getByLabel(/Consignes de résolution/).fill("Faire contresigner le bon par Rita Recette (donneur d'ordre) et déposer le scan.");
  await shot(page, "recette-constat-remise-incident", info.project.name);
  await f.getByRole("button", { name: "Enregistrer le constat de remise" }).click();
  await expect(flash(page)).toContainText("remise avec INCIDENT ouvert");
  await expect(page.locator("h1")).toContainText("1 incident(s) ouvert(s)");
  await expect(page.locator("h1")).toContainText("exécution partielle : 2/3 remis");
  await expect(page.locator("li", { hasText: "Par Léo Livreur" }).first()).toContainText("scan du bon signé non déposé");
  // tableau de bord : incident visible
  await page.goto("/admin");
  await expect(page.locator("#incidents")).toContainText(reference);
  await expect(page.locator("#incidents")).toContainText("Refus de signature");
  await page.goto(detailUrl);
  // le lendemain : 3e appareil, remise conforme avec scan du bon signé
  f = page.locator("#constat-remise");
  await f.getByLabel("Date réelle de remise").fill(inDays(-2));
  await f.getByLabel("Heure réelle (Paris)").fill("08:30");
  await f.getByLabel("Personne qui a remis le matériel").fill("Léo Livreur");
  await f.getByLabel("Notice Ingaro remise").check();
  await f.getByLabel(/bon signé par le réceptionnaire/).check();
  await f.locator('input[name="signedScan"]').setInputFiles(PDF_SCAN);
  await f.getByRole("button", { name: "Enregistrer le constat de remise" }).click();
  await expect(flash(page)).toContainText("remise conforme");
  await expect(page.locator("h1")).not.toContainText("exécution partielle");
  // scan du 1er constat déposé après coup, puis incident résolu
  const first = page.locator("li", { hasText: "09:40 — 2 appareil(s)" });
  await first.locator('input[name="signedScan"]').setInputFiles(PDF_SCAN);
  await first.getByRole("button", { name: "Déposer" }).click();
  await expect(flash(page)).toContainText("Scan du bon signé enregistré");
  const scanLink = page.locator("li", { hasText: "09:40 — 2 appareil(s)" }).getByRole("link", { name: /scan du bon signé 1/ });
  const res = await page.request.get((await scanLink.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-"); // déchiffré côté serveur
  await expect(page.locator("li", { hasText: "09:40 — 2 appareil(s)" })).toContainText("(chiffré)");
  const inc = page.locator("#incidents li", { hasText: "Refus de signature" });
  await inc.getByLabel("Résolution").fill("Bon contresigné par le donneur d'ordre le lendemain ; scan déposé.");
  await inc.getByRole("button", { name: "Clôturer l'incident" }).click();
  await expect(flash(page)).toContainText("Incident résolu");
  await expect(page.locator("h1")).not.toContainText("incident(s) ouvert(s)");
  await shot(page, "recette-constats-incident-resolu", info.project.name);
  await page.goto("/admin/materiel");
  await expect(page.locator("tr", { hasText: "RC-006" })).toContainText(`chez le client — ${reference}`);
});

test("7. Reprise PARTIELLE (2 sur 3, un dégradé) : les 2 repris attendent le contrôle, le 3e reste bloqué", async ({ page }, info) => {
  await login(page);
  await page.goto(detailUrl);
  const f = page.locator("#constat-reprise");
  await f.getByLabel("Date réelle de reprise").fill(inDays(-1));
  await f.getByLabel("Heure réelle (Paris)").fill("10:15");
  await f.getByLabel("Personne qui a repris le matériel").fill("Léo Livreur");
  await f.getByLabel("RC-006 récupéré").check();
  await f.getByLabel("RC-007 récupéré").check();
  await f.getByLabel("État de RC-007").selectOption("degrade");
  await f.getByLabel("Observation RC-007").fill("Roulette cassée");
  await f.getByLabel(/bon signé par le réceptionnaire/).check();
  await f.locator('input[name="signedScan"]').setInputFiles(PDF_SCAN);
  await shot(page, "recette-constat-reprise-partielle", info.project.name);
  await f.getByRole("button", { name: "Enregistrer le constat de reprise" }).click();
  await expect(flash(page)).toContainText("Reprise partielle enregistrée : 1 appareil(s) encore chez le client");
  await expect(flash(page)).toContainText("en attente de contrôle technique");
  await expect(page.locator("h1 .badge").first()).toHaveText("Livrée");
  await page.goto("/admin/materiel");
  await expect(page.locator("tr", { hasText: "RC-006" })).toContainText("non louable"); // reprise conforme ≠ louable
  await expect(page.locator("tr", { hasText: "RC-007" })).toContainText("non louable");
  await expect(page.locator("tr", { hasText: "RC-008" })).toContainText("chez le client");
});

test("8. Contrôle technique : RC-006 approuvé ⇒ disponible ; RC-007 ⇒ hors service", async ({ page }, info) => {
  await login(page);
  await inspectUnit(page, "RC-006", "bon", info, "controle-technique-formulaire");
  await expect(page.locator("tr", { hasText: "RC-006" })).toContainText("disponible");
  await inspectUnit(page, "RC-007", "hors_service", info);
  await expect(page.locator("tr", { hasText: "RC-007" })).toContainText("non louable");
  await expect(page.locator("#controles")).toContainText("RC-007 : a_controler → hors_service");
  await shot(page, "controle-technique-historique", info.project.name);
});

test("9. Reprise complète → « Reprise effectuée », contrôle, clôture, parc disponible", async ({ page }, info) => {
  await login(page);
  await page.goto(detailUrl);
  const f = page.locator("#constat-reprise");
  await f.getByLabel("Date réelle de reprise").fill(inDays(-1));
  await f.getByLabel("Heure réelle (Paris)").fill("16:00");
  await f.getByLabel("Personne qui a repris le matériel").fill("Léo Livreur");
  await f.getByLabel("RC-008 récupéré").check();
  await f.getByLabel(/bon signé par le réceptionnaire/).check();
  await f.getByRole("button", { name: "Enregistrer le constat de reprise" }).click();
  await expect(flash(page)).toContainText("Reprise complète enregistrée");
  await expect(page.locator("h1 .badge").first()).toHaveText("Reprise effectuée");
  const duree = page.locator(".box", { has: page.getByRole("heading", { name: /Durée constatée/ }) });
  await expect(duree).toContainText("non définie — durée facturable à déterminer");
  await page.getByLabel("Nouveau statut").selectOption("cloturee");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.locator("h1 .badge").first()).toHaveText("Clôturée");
  await page.goto("/admin/materiel");
  await expect(page.locator("tr", { hasText: "RC-008" })).toContainText("non louable");
  await inspectUnit(page, "RC-008", "bon", info);
  await expect(page.locator("tr", { hasText: "RC-006" })).toContainText("disponible");
  await expect(page.locator("tr", { hasText: "RC-008" })).toContainText("disponible");
  await page.goto(detailUrl);
  await expect(page.getByRole("heading", { name: "Journal immuable du matériel" })).toBeVisible();
  await expect(page.locator(".box", { hasText: "Journal immuable du matériel" })).toContainText("controle RC-006");
  await shot(page, "recette-fin-de-location", info.project.name);
  await page.goto("/admin/materiel");
  await shot(page, "recette-parc-disponible", info.project.name);
});
