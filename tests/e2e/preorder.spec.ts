import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { datesAndZone, heatingNeed, next, noHorizontalOverflow, shot } from "./helpers";

function mailsContaining(s: string) {
  try {
    return readdirSync("test-results/e2e-mail").map((f) => JSON.parse(readFileSync(`test-results/e2e-mail/${f}`, "utf8"))).filter((m) => JSON.stringify(m).includes(s));
  } catch {
    return [];
  }
}

test.describe("tunnel de précommande", () => {
  test("recette 1 : particulier 25 m², 1 pièce, bonne isolation → 1 radiateur ; il en choisit 2 avec avertissement ; envoi réel", async ({ page }, info) => {
    await heatingNeed(page, { surface: "25", rooms: "1", insulation: /^Bonne/, place: "appartement" });
    await expect(page.locator(".result-big")).toHaveText(/1 appareil de 2000 W/);
    await shot(page, "assistant-recommandation", info.project.name);
    await page.getByRole("button", { name: "Augmenter la quantité" }).click();
    await expect(page.getByLabel("Quantité souhaitée")).toHaveText("2");
    await expect(page.getByText(/2 × 2 kW = 4 kW/)).toBeVisible();
    await expect(page.getByText(/plusieurs prises peuvent partager un même circuit/)).toBeVisible();
    await noHorizontalOverflow(page);
    await next(page);
    await datesAndZone(page, { days: "7", postalCode: "69003" });
    // 2 × 59 + 79 = 197 € HT ; 236,40 € TTC
    await expect(page.getByText("197,00 €").first()).toBeVisible();
    await expect(page.getByText("236,40 €")).toBeVisible();
    await shot(page, "assistant-prix", info.project.name);
    await next(page);
    await page.getByLabel("Vous êtes").selectOption("particulier");
    await expect(page.getByLabel(/SIRET/)).toHaveCount(0); // SIRET seulement pour les pros
    await page.getByLabel("Nom du contact").fill("Paul Particulier");
    await page.getByLabel("Téléphone", { exact: true }).fill("06 11 22 33 44");
    await page.getByLabel("Email").fill("paul@e2e.invalid");
    await page.getByLabel(/C'est moi qui réceptionnerai/).check();
    await page.getByLabel("Numéro et rue").fill("3 rue des Tests");
    await page.getByLabel("Commune").fill("Lyon");
    await next(page);
    await expect(page.getByRole("heading", { name: "Vérifiez et envoyez votre demande" })).toBeVisible();
    await expect(page.locator(".summary-table").first()).toContainText("2 appareils de 2000 W");
    await page.getByLabel(/demande sans paiement, sous réserve de confirmation/).check();
    await page.getByLabel(/politique de confidentialité/).check();
    await shot(page, "assistant-recapitulatif", info.project.name);
    await page.getByRole("button", { name: "Envoyer ma demande" }).click();
    const ref = page.locator(".ref");
    await expect(ref).toHaveText(/^RC-\d{4}-\d{6}$/);
    await expect(page.getByText("Aucun paiement n'a été effectué.")).toBeVisible();
    await expect(page.getByText(/Notre équipe vous recontactera pour confirmer la disponibilité, le prix et le créneau/)).toBeVisible();
    await shot(page, "assistant-succes", info.project.name);
    const reference = (await ref.textContent())!;
    // accusé client + alerte équipe envoyés (transport fichier)
    await expect.poll(() => mailsContaining(reference).length, { timeout: 15_000 }).toBe(2);
    const ack = mailsContaining(reference).find((m) => m.to === "paul@e2e.invalid");
    expect(ack.text).toContain(`Votre demande n° ${reference} est bien reçue`);
    expect(ack.text).toContain("Aucun paiement n'a été effectué");
    // brouillon effacé après succès
    expect(await page.evaluate(() => localStorage.getItem("rc_demande_brouillon_v2"))).toBeNull();
  });

  test("recette 4 : climatisation → lead complet « sur devis », sans faux prix", async ({ page }) => {
    await page.goto("/demande?service=climatisation");
    await next(page);
    await page.getByLabel("Surface (m²)").fill("30");
    await page.getByLabel("Sud").check();
    await page.getByLabel("Moyenne").check();
    await page.getByLabel("Par une fenêtre").check();
    await page.getByLabel("Oui", { exact: true }).check();
    await next(page);
    await page.getByLabel("Type de lieu").selectOption("bureau");
    await next(page);
    await expect(page.getByText(/kW froid/).first()).toBeVisible();
    await expect(page.getByText(/BTU\/h/)).toBeVisible();
    await next(page);
    await datesAndZone(page, { postalCode: "69002", unknown: true });
    await expect(page.getByText("Prix : sur devis.")).toBeVisible();
    expect(await page.locator("form").innerText()).not.toMatch(/\d+,\d{2} €/);
    await next(page);
    await page.getByLabel("Vous êtes").selectOption("entreprise");
    await page.getByLabel("Raison sociale").fill("Bureau Clim SAS");
    await page.getByLabel("Nom du contact").fill("Claire Clim");
    await page.getByLabel("Téléphone", { exact: true }).fill("06 22 33 44 55");
    await page.getByLabel("Email").fill("claire@e2e.invalid");
    await page.getByLabel(/C'est moi qui réceptionnerai/).check();
    await page.getByLabel("Numéro et rue").fill("8 quai Test");
    await page.getByLabel("Commune").fill("Lyon");
    await next(page);
    await page.getByLabel(/demande sans paiement/).check();
    await page.getByLabel(/politique de confidentialité/).check();
    await page.getByRole("button", { name: "Envoyer ma demande" }).click();
    await expect(page.locator(".ref")).toHaveText(/^RC-/);
    await expect(page.getByText(/Le prix vous sera communiqué sur devis/)).toBeVisible();
  });

  test("recette 12 : API/base en panne → échec visible, aucune fausse réussite, saisie conservée", async ({ page }) => {
    await page.route("**/api/requests", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "db_unavailable", message: "Votre demande n'a pas pu être enregistrée (service momentanément indisponible). Vos informations sont conservées sur cet appareil : réessayez dans quelques instants." }) }),
    );
    await heatingNeed(page, { surface: "40", rooms: "2", insulation: /^Moyenne/, place: "maison" });
    await next(page);
    await datesAndZone(page, { days: "5", postalCode: "69100" });
    await next(page);
    await page.getByLabel("Vous êtes").selectOption("particulier");
    await page.getByLabel("Nom du contact").fill("Panne Test");
    await page.getByLabel("Téléphone", { exact: true }).fill("06 99 88 77 66");
    await page.getByLabel("Email").fill("panne@e2e.invalid");
    await page.getByLabel(/C'est moi qui réceptionnerai/).check();
    await page.getByLabel("Numéro et rue").fill("1 rue Panne");
    await page.getByLabel("Commune").fill("Villeurbanne");
    await next(page);
    await page.getByLabel(/demande sans paiement/).check();
    await page.getByLabel(/politique de confidentialité/).check();
    await page.getByRole("button", { name: "Envoyer ma demande" }).click();
    await expect(page.locator(".notice[role=alert]")).toContainText("Demande non envoyée");
    await expect(page.locator(".ref")).toHaveCount(0);
    await expect(page.getByText(/est bien reçue/)).toHaveCount(0);
    // rechargement : la saisie est restaurée depuis l'appareil
    await page.reload();
    await expect(page.getByText(/Nous avons retrouvé votre saisie/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vérifiez et envoyez votre demande" })).toBeVisible();
    await expect(page.locator(".summary-table").first()).toContainText("panne@e2e.invalid");
    // le service revient : l'envoi réussit avec la même clé d'idempotence
    await page.unroute("**/api/requests");
    await page.getByLabel(/demande sans paiement/).check();
    await page.getByLabel(/politique de confidentialité/).check();
    await page.getByRole("button", { name: "Envoyer ma demande" }).click();
    await expect(page.locator(".ref")).toHaveText(/^RC-/);
  });

  test("accessibilité clavier : premier écran utilisable au clavier", async ({ page }) => {
    await page.goto("/demande");
    await page.getByLabel(/J'ai besoin de chauffage/).focus();
    await page.keyboard.press("Space");
    await expect(page.getByLabel(/J'ai besoin de chauffage/)).toBeChecked();
    await page.keyboard.press("Enter"); // soumet l'étape
    await expect(page.getByRole("heading", { name: "Quelle surface souhaitez-vous chauffer ?" })).toBeFocused();
    // validation : erreur annoncée sans avancer
    await page.getByLabel("Surface totale à chauffer (m²)").fill("");
    await next(page);
    await expect(page.locator(".notice[role=alert]")).toContainText("Indiquez une surface");
  });
});
