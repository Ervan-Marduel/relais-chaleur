/** Vérifie la liste d'ouverture commerciale. Code de sortie 1 si un élément bloquant manque. */
import { launchReadiness, effectiveSiteMode } from "../src/server/env";

const items = launchReadiness();
for (const i of items) console.log(`${i.ok ? "✔" : "✘"} ${i.label}`);
console.log(`\nMode demandé : ${process.env.SITE_MODE ?? "preproduction"} — mode effectif : ${effectiveSiteMode()}`);
if (items.some((i) => !i.ok)) {
  console.log("\n→ Le site reste en PRÉ-PRODUCTION (non indexé, bandeau visible) tant que ces éléments manquent.");
  process.exitCode = 1;
}
