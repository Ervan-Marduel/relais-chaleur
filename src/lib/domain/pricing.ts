import type { BusinessSettings, Zone } from "./settings";

/**
 * Tarification chauffage — calculée CÔTÉ SERVEUR, figée dans chaque demande.
 * Ne produit JAMAIS de tarif arbitraire : toute situation non couverte par la grille → « sur devis ».
 * L'express n'est jamais ajouté au total estimé (uniquement si confirmé par l'équipe dans un devis).
 */
export type ClientKind = "particulier" | "entreprise" | "syndic" | "autre";

export type PricingInput = {
  service: "chauffage" | "climatisation";
  quantity: number;
  /** Durée estimée déclarée en jours ; null = inconnue. */
  estimatedDays: number | null;
  postalCode: string;
  expressRequested: boolean;
  multiSite: boolean;
  placeType?: string;
  manualReview?: boolean;
};

export type QuoteReason =
  | "climatisation_sur_devis"
  | "duree_inconnue"
  | "duree_hors_grille"
  | "hors_zone"
  | "quantite_hors_grille"
  | "multi_sites"
  | "erp_ecole"
  | "etude_necessaire"
  | "chauffage_desactive";

export const QUOTE_REASON_TEXT: Record<QuoteReason, string> = {
  climatisation_sur_devis: "Climatisation : prix sur devis (gamme et tarifs en cours de validation).",
  duree_inconnue: "Durée inconnue : prix établi sur devis.",
  duree_hors_grille: "Durée au-delà de la grille publiée : prix sur devis.",
  hors_zone: "Adresse hors de la zone tarifée : livraison et reprise sur devis.",
  quantite_hors_grille: "Quantité au-delà de la grille logistique : prix sur devis.",
  multi_sites: "Plusieurs logements / sites : devis groupé personnalisé.",
  erp_ecole: "ERP / école : devis soumis à validation préalable.",
  etude_necessaire: "Configuration atypique : étude du site nécessaire avant tout prix.",
  chauffage_desactive: "Offre momentanément indisponible : prix sur devis.",
};

export type PriceLine = { code: string; label: string; quantity: number; unitHtCents: number; totalHtCents: number };

export type PriceEstimate =
  | {
      mode: "estimate";
      lines: PriceLine[];
      totalHtCents: number;
      vatRateBp: number;
      vatCents: number;
      totalTtcCents: number;
      zoneId: string;
      zoneLabel: string;
      expressOptionHtCents: number | null;
      notes: string[];
    }
  | {
      mode: "sur_devis";
      reasons: QuoteReason[];
      /** Lignes partielles connues (ex. location) — affichées à titre d'information seulement. */
      partialLines: PriceLine[];
      zoneId: string | null;
      expressOptionHtCents: number | null;
      notes: string[];
    };

export function findZone(postalCode: string, settings: BusinessSettings): Zone | null {
  const pc = postalCode.trim();
  return settings.zones.find((z) => z.postalCodes.includes(pc)) ?? null;
}

export function vatOf(htCents: number, settings: BusinessSettings) {
  if (!settings.vatApplicable) return 0;
  // arrondi au centime le plus proche (demi vers le haut)
  return Math.round((htCents * settings.vatRateBp) / 10000);
}

export function estimatePrice(input: PricingInput, settings: BusinessSettings): PriceEstimate {
  const notes = [
    "Électricité non incluse.",
    "Prix estimatif sous réserve de confirmation du stock, de la zone, de la capacité électrique et du créneau.",
    "La durée facturable sera déterminée selon les dates réelles de mise à disposition et de reprise et les conditions de location convenues.",
  ];
  if (settings.vatApplicable) notes.push(settings.vatNote);
  const expressOption = input.expressRequested ? settings.heating.expressSurchargeHtCents : null;
  if (expressOption != null) notes.push("Option express demandée : supplément ajouté uniquement si l'équipe le confirme.");

  const zone = findZone(input.postalCode, settings);
  const reasons: QuoteReason[] = [];
  const partial: PriceLine[] = [];

  if (input.service === "climatisation") {
    return { mode: "sur_devis", reasons: ["climatisation_sur_devis"], partialLines: [], zoneId: zone?.id ?? null, expressOptionHtCents: expressOption, notes };
  }
  if (!settings.heating.enabled) reasons.push("chauffage_desactive");
  const q = input.quantity;
  if (!Number.isInteger(q) || q < 1) throw new RangeError("Quantité invalide");

  let tier = null as null | BusinessSettings["heating"]["rentalTiers"][number];
  if (input.estimatedDays == null) reasons.push("duree_inconnue");
  else {
    tier = settings.heating.rentalTiers.find((t) => input.estimatedDays! >= t.minDays && input.estimatedDays! <= t.maxDays) ?? null;
    if (!tier) reasons.push("duree_hors_grille");
  }
  if (tier) {
    partial.push({
      code: "location",
      label: `Location ${tier.minDays} à ${tier.maxDays} jours, par appareil`,
      quantity: q,
      unitHtCents: tier.unitPriceHtCents,
      totalHtCents: q * tier.unitPriceHtCents,
    });
  }

  let logistics = null as null | Zone["logistics"][number];
  if (!zone) reasons.push("hors_zone");
  else {
    logistics = zone.logistics.find((l) => q >= l.minUnits && q <= l.maxUnits) ?? null;
    if (!logistics) reasons.push("quantite_hors_grille");
  }
  if (input.multiSite) reasons.push("multi_sites");
  if (input.placeType === "erp_ecole") reasons.push("erp_ecole");
  if (input.manualReview && input.placeType !== "erp_ecole") reasons.push("etude_necessaire");

  if (reasons.length > 0 || !tier || !logistics || !zone) {
    return { mode: "sur_devis", reasons: unique(reasons), partialLines: partial, zoneId: zone?.id ?? null, expressOptionHtCents: expressOption, notes };
  }

  const lines: PriceLine[] = [
    ...partial,
    {
      code: "logistique",
      label: `Livraison ET reprise (aller + retour) — ${zone.label}, ${logistics.minUnits} à ${logistics.maxUnits} appareils`,
      quantity: 1,
      unitHtCents: logistics.priceHtCents,
      totalHtCents: logistics.priceHtCents,
    },
  ];
  const totalHtCents = lines.reduce((a, l) => a + l.totalHtCents, 0);
  const vatCents = vatOf(totalHtCents, settings);
  return {
    mode: "estimate",
    lines,
    totalHtCents,
    vatRateBp: settings.vatApplicable ? settings.vatRateBp : 0,
    vatCents,
    totalTtcCents: totalHtCents + vatCents,
    zoneId: zone.id,
    zoneLabel: zone.label,
    expressOptionHtCents: expressOption,
    notes,
  };
}

function unique<T>(a: T[]) {
  return [...new Set(a)];
}

export function formatEuros(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}
