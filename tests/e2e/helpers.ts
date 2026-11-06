import { expect, type Page } from "@playwright/test";

export const inDays = (n: number) => {
  const d = new Date(Date.now() + n * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

export async function next(page: Page) {
  await page.getByRole("button", { name: /Continuer|Vérifier ma demande/ }).click();
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "débordement horizontal").toBeLessThanOrEqual(0);
}

export async function shot(page: Page, name: string, project: string) {
  await page.screenshot({ path: `docs/captures/${name}-${project}.png`, fullPage: true });
}

/** Parcours chauffage jusqu'à l'étape « Recommandation ». */
export async function heatingNeed(page: Page, o: { surface: string; rooms: string; insulation: RegExp; place: string }) {
  await page.goto("/demande?service=chauffage");
  await expect(page.getByLabel(/J'ai besoin de chauffage/)).toBeChecked();
  await next(page);
  await page.getByLabel("Surface totale à chauffer (m²)").fill(o.surface);
  await page.getByLabel("Nombre de pièces concernées").fill(o.rooms);
  await page.getByLabel(o.insulation).check();
  await next(page);
  await page.getByLabel("Type de lieu").selectOption(o.place);
  await next(page);
  await expect(page.getByRole("heading", { name: "Notre recommandation indicative" })).toBeVisible();
}

export async function datesAndZone(page: Page, o: { days?: string; postalCode: string; unknown?: boolean }) {
  await page.getByLabel("Date de début souhaitée").fill(inDays(10));
  if (o.unknown) await page.getByLabel(/Durée inconnue/).check();
  else await page.getByLabel("Durée estimée (jours)").fill(o.days ?? "7");
  await page.getByLabel("Code postal du lieu de livraison").fill(o.postalCode);
}
