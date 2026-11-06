import type { BusinessSettings } from "./settings";

/**
 * Estimateur CLIMATISATION — distinct du chauffage (aucune règle reprise).
 * Fournit une FOURCHETTE indicative de puissance frigorifique (W froid et BTU/h),
 * et des points de faisabilité (évacuation d'air chaud, bruit, alimentation).
 * Pas de prix tant que cooling.pricingEnabled = false. À valider par l'équipe.
 */
export type Exposure = "nord" | "est" | "ouest" | "sud" | "inconnue";
export type CoolingInput = {
  surfaceM2: number;
  rooms: number;
  ceilingHeightM: number;
  exposure: Exposure;
  insulation: "bonne" | "moyenne" | "faible" | "inconnue";
  people?: number | null;
  /** Possibilité de faire passer une gaine / d'évacuer l'air chaud (fenêtre, ouverture). */
  exhaust: "fenetre" | "ouverture_murale" | "non" | "inconnu";
  noiseSensitive: boolean;
  /** Prise disponible à proximité. */
  power: "oui" | "non" | "inconnu";
};

export type CoolingEstimate = {
  lowW: number;
  highW: number;
  lowBtu: number;
  highBtu: number;
  feasibilityNotes: string[];
  requiresManualReview: true;
};

const BTU_PER_W = 3.412;

export function estimateCooling(input: CoolingInput, settings: BusinessSettings): CoolingEstimate {
  const c = settings.cooling.sizing;
  if (!(input.surfaceM2 > 0)) throw new RangeError("Surface invalide");
  const hf = Math.max(1, input.ceilingHeightM / c.referenceHeightM);
  const f = c.exposureFactor[input.exposure] * c.insulationFactor[input.insulation] * hf;
  const people = Math.max(0, (input.people ?? 0) - 2) * c.extraWPerPersonAbove2;
  const lowW = roundTo(input.surfaceM2 * c.lowWPerM2 * f + people, 100);
  const highW = roundTo(input.surfaceM2 * c.highWPerM2 * f + people, 100);
  const notes: string[] = [];
  if (input.exhaust === "non")
    notes.push("Un climatiseur mobile doit évacuer l'air chaud vers l'extérieur : sans fenêtre ou ouverture, une solution adaptée doit être étudiée.");
  if (input.exhaust === "inconnu") notes.push("Possibilité d'évacuation d'air chaud à confirmer (fenêtre, ouverture).");
  if (input.noiseSensitive) notes.push("Sensibilité au bruit signalée : le niveau sonore des appareils sera précisé lors du devis.");
  if (input.power !== "oui") notes.push("Alimentation électrique à proximité à confirmer ; capacité du circuit à vérifier par une personne compétente.");
  if (input.rooms > 1) notes.push("Plusieurs pièces : un appareil mobile refroidit en général une seule pièce fermée.");
  notes.push("Fourchette indicative, à valider : elle ne constitue ni une étude thermique ni une garantie de température.");
  return {
    lowW, highW,
    lowBtu: roundTo(lowW * BTU_PER_W, 500),
    highBtu: roundTo(highW * BTU_PER_W, 500),
    feasibilityNotes: notes,
    requiresManualReview: true,
  };
}

function roundTo(x: number, step: number) {
  return Math.round(x / step) * step;
}
