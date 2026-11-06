/**
 * FICHIER DE CONFIGURATION MÉTIER — valeurs par défaut (version 1 de la grille).
 *
 * Ces valeurs initialisent la table `pricing_versions` au premier `npm run db:seed`.
 * Ensuite, la source de vérité est le back-office (/admin/parametres) qui crée
 * une NOUVELLE version à chaque modification. Modifier ce fichier n'a d'effet
 * que sur une base vierge.
 *
 * Tous les montants sont en CENTIMES HT. Source : grille-tarifs.csv + business-plan.md
 * (« tarifs pilote / de test » approuvés par le dirigeant — à reconfirmer avant ouverture).
 */
import type { BusinessSettings } from "../src/lib/domain/settings";

const LYON_VILLEURBANNE = [
  "69001", "69002", "69003", "69004", "69005", "69006", "69007", "69008", "69009", // Lyon 1er → 9e
  "69100", // Villeurbanne
];

export const defaultBusinessSettings: BusinessSettings = {
  currency: "EUR",
  vatApplicable: true,
  vatRateBp: 2000, // 20 % — indicatif, à confirmer selon le statut fiscal du loueur
  vatNote: "TVA indicative de 20 %, à confirmer selon le statut du loueur.",
  heating: {
    enabled: true,
    rentalTiers: [
      { minDays: 1, maxDays: 3, unitPriceHtCents: 3900 },
      { minDays: 4, maxDays: 7, unitPriceHtCents: 5900 },
      { minDays: 8, maxDays: 14, unitPriceHtCents: 8800 },
      { minDays: 15, maxDays: 28, unitPriceHtCents: 12900 },
      // > 28 jours ou durée inconnue : sur devis (aucune ligne ⇒ sur devis)
    ],
    expressSurchargeHtCents: 4500, // uniquement si confirmé par l'équipe, jamais ajouté automatiquement
    sizing: {
      unitPowerW: 2000,
      nominalVoltage: 230,
      // Règle de départ : 80 W/m² ≈ 25 m² pour 2 000 W (bonne isolation, 2,50 m)
      wattsPerM2: { bonne: 80, moyenne: 100, faible: 120 },
      unknownInsulationAs: "moyenne",
      referenceHeightM: 2.5,
      maxHeightM: 3.5,
      maxRoomSurfaceM2: 60,
      maxTotalSurfaceM2: 250,
      maxRooms: 12,
      maxUnitsPerDwellingAuto: 6,
      maxSelectableUnits: 30,
    },
  },
  cooling: {
    pricingEnabled: false, // aucune grille climatisation validée → « sur devis »
    sizing: {
      lowWPerM2: 90,
      highWPerM2: 130,
      exposureFactor: { nord: 0.9, est: 1.0, ouest: 1.15, sud: 1.15, inconnue: 1.1 },
      insulationFactor: { bonne: 0.9, moyenne: 1.0, faible: 1.15, inconnue: 1.1 },
      extraWPerPersonAbove2: 120,
      referenceHeightM: 2.5,
    },
  },
  zones: [
    {
      id: "lyon-villeurbanne",
      label: "Lyon (69001–69009) et Villeurbanne (69100)",
      postalCodes: LYON_VILLEURBANNE,
      logistics: [
        { minUnits: 1, maxUnits: 3, priceHtCents: 7900 }, // livraison ET reprise
        { minUnits: 4, maxUnits: 8, priceHtCents: 11900 },
        // 9+ appareils : sur devis
      ],
    },
  ],
  operations: {
    vehicles: [{ id: "utilitaire-1", label: "Utilitaire (à confirmer)", maxUnits: 10 }],
    responseTargetHours: null,
    showResponseTargetPublicly: false,
  },
  rental: { dayCountRule: null }, // à définir après validation juridique des CGL
  legal: {
    termsVersion: "CGL-brouillon-2026-11",
    privacyVersion: "CONF-brouillon-2026-11",
  },
};
