import type { BusinessSettings, Insulation } from "./settings";

/**
 * Estimation INDICATIVE du nombre d'appareils de chauffage d'appoint.
 *
 * Règle (paramétrable dans pricing_versions.payload.heating.sizing) :
 *   W/m² selon isolation (bonne 80 / moyenne 100 / faible 120 par défaut)
 *   facteur hauteur = max(1, hauteur / hauteur_ref)   (volume plus grand ⇒ plus de puissance)
 *   par pièce : ceil(surface × W/m² × facteur / puissance_appareil), minimum 1 par pièce occupée
 *
 * On calcule PAR PIÈCE : un radiateur ne chauffe pas uniformément deux pièces fermées.
 * Si seule la surface totale est connue, elle est répartie également (précision limitée, signalée).
 *
 * Ce résultat n'est ni une étude thermique, ni une validation électrique, ni une garantie de température.
 */

export type PlaceType =
  | "appartement" | "maison" | "bureau" | "commerce" | "copropriete" | "local" | "erp_ecole";

export type HeatingInput = {
  /** Surfaces détaillées par pièce (m²) — prioritaire si fourni. */
  roomSurfaces?: number[];
  totalSurfaceM2?: number;
  rooms?: number;
  ceilingHeightM: number;
  insulation: Insulation;
  placeType: PlaceType;
};

export type HeatingWarningCode =
  | "surface_repartie"
  | "hauteur_ajustee"
  | "hauteur_atypique"
  | "piece_grande"
  | "surface_totale_grande"
  | "pieces_nombreuses"
  | "isolation_inconnue"
  | "beaucoup_appareils_logement"
  | "erp_validation";

export type HeatingEstimate = {
  perRoom: { surfaceM2: number; units: number; powerW: number }[];
  recommendedUnits: number;
  totalPowerW: number;
  amperesPerUnit: number;
  wattsPerM2Used: number;
  heightFactor: number;
  insulationUsed: "bonne" | "moyenne" | "faible";
  warnings: HeatingWarningCode[];
  /** true ⇒ aucune acceptation automatique : étude / devis manuel obligatoire. */
  requiresManualReview: boolean;
};

export const HEATING_WARNING_TEXT: Record<HeatingWarningCode, string> = {
  surface_repartie:
    "Surface totale répartie également entre les pièces : précision limitée. Détaillez les pièces pour affiner.",
  hauteur_ajustee: "Hauteur sous plafond supérieure à la référence : besoin augmenté proportionnellement au volume.",
  hauteur_atypique: "Hauteur sous plafond atypique : estimation uniquement, étude du site nécessaire (devis manuel).",
  piece_grande: "Pièce de grande surface : estimation uniquement, étude du site nécessaire.",
  surface_totale_grande: "Surface totale importante : estimation uniquement, étude du site nécessaire.",
  pieces_nombreuses: "Nombre de pièces important : estimation uniquement, étude du site nécessaire.",
  isolation_inconnue: "Isolation inconnue : hypothèse prudente retenue, à confirmer lors de notre appel.",
  beaucoup_appareils_logement:
    "Nombre d'appareils élevé pour un même logement : validation humaine obligatoire (capacité électrique à vérifier).",
  erp_validation:
    "ERP / école : traitement séparé, devis soumis à validation préalable du responsable du site. Aucune acceptation automatique.",
};

const EPS = 1e-9;

export function estimateHeating(input: HeatingInput, settings: BusinessSettings): HeatingEstimate {
  const s = settings.heating.sizing;
  const warnings: HeatingWarningCode[] = [];

  let surfaces: number[];
  if (input.roomSurfaces && input.roomSurfaces.length > 0) {
    surfaces = input.roomSurfaces.map((x) => round2(x));
  } else {
    const total = input.totalSurfaceM2 ?? 0;
    const rooms = Math.max(1, Math.floor(input.rooms ?? 1));
    surfaces = Array.from({ length: rooms }, () => round2(total / rooms));
    if (rooms > 1) warnings.push("surface_repartie");
  }
  if (surfaces.some((x) => !(x > 0))) throw new RangeError("Surface de pièce invalide");

  let insulationUsed: "bonne" | "moyenne" | "faible";
  if (input.insulation === "inconnue") {
    insulationUsed = s.unknownInsulationAs;
    warnings.push("isolation_inconnue");
  } else insulationUsed = input.insulation;

  const wpm2 = s.wattsPerM2[insulationUsed];
  const h = input.ceilingHeightM;
  if (!(h > 0)) throw new RangeError("Hauteur invalide");
  const heightFactor = Math.max(1, h / s.referenceHeightM);
  if (heightFactor > 1 + EPS) warnings.push("hauteur_ajustee");
  if (h > s.maxHeightM + EPS) warnings.push("hauteur_atypique");

  const perRoom = surfaces.map((surfaceM2) => {
    const neededW = surfaceM2 * wpm2 * heightFactor;
    const units = Math.max(1, Math.ceil(neededW / s.unitPowerW - EPS));
    return { surfaceM2, units, powerW: units * s.unitPowerW };
  });
  const recommendedUnits = perRoom.reduce((a, r) => a + r.units, 0);
  const totalSurface = surfaces.reduce((a, x) => a + x, 0);

  if (surfaces.some((x) => x > s.maxRoomSurfaceM2)) warnings.push("piece_grande");
  if (totalSurface > s.maxTotalSurfaceM2) warnings.push("surface_totale_grande");
  if (surfaces.length > s.maxRooms) warnings.push("pieces_nombreuses");
  const dwelling = input.placeType === "appartement" || input.placeType === "maison";
  if (dwelling && recommendedUnits > s.maxUnitsPerDwellingAuto) warnings.push("beaucoup_appareils_logement");
  if (input.placeType === "erp_ecole") warnings.push("erp_validation");

  const manualCodes: HeatingWarningCode[] = [
    "hauteur_atypique", "piece_grande", "surface_totale_grande", "pieces_nombreuses",
    "beaucoup_appareils_logement", "erp_validation",
  ];

  return {
    perRoom,
    recommendedUnits,
    totalPowerW: recommendedUnits * s.unitPowerW,
    amperesPerUnit: round1(s.unitPowerW / s.nominalVoltage),
    wattsPerM2Used: wpm2,
    heightFactor: round2(heightFactor),
    insulationUsed,
    warnings,
    requiresManualReview: warnings.some((w) => manualCodes.includes(w)),
  };
}

/** Avertissements liés à la quantité CHOISIE par le client (peut différer de la recommandation). */
export function quantityWarnings(chosen: number, recommended: number, settings: BusinessSettings, placeType: PlaceType) {
  const s = settings.heating.sizing;
  const out: string[] = [];
  out.push(
    `Puissance totale : ${chosen} × ${s.unitPowerW / 1000} kW = ${formatKw(chosen * s.unitPowerW)}. ` +
      `Intensité nominale par appareil ≈ ${round1(s.unitPowerW / s.nominalVoltage).toString().replace(".", ",")} A à ${s.nominalVoltage} V.`,
  );
  if (chosen > recommended) {
    out.push(
      "Vous avez choisi plus d'appareils que la recommandation : plusieurs prises peuvent partager un même circuit. " +
        "La capacité électrique doit être vérifiée par une personne compétente avant utilisation simultanée.",
    );
  }
  if (chosen < recommended) {
    out.push("Quantité inférieure à la recommandation indicative : le confort obtenu pourrait être insuffisant.");
  }
  const dwelling = placeType === "appartement" || placeType === "maison";
  if (dwelling && chosen > s.maxUnitsPerDwellingAuto) {
    out.push("Nombre élevé d'appareils dans un même logement : validation humaine obligatoire avant toute confirmation.");
  }
  return out;
}

export function formatKw(w: number) {
  return `${(w / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kW`;
}
function round2(x: number) {
  return Math.round(x * 100) / 100;
}
function round1(x: number) {
  return Math.round(x * 10) / 10;
}
