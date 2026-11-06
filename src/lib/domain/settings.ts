import { z } from "zod";

/**
 * Paramètres métier VERSIONNÉS (table pricing_versions).
 * Chaque modification en back-office crée une nouvelle version immuable ;
 * chaque demande fige la version utilisée (estimate_snapshot) pour qu'un
 * changement de grille n'affecte jamais une demande ancienne.
 *
 * Montants en CENTIMES HT (entiers) pour éviter les erreurs d'arrondi.
 */
const cents = z.number().int().min(0).max(10_000_000);

export const rentalTierSchema = z.object({
  minDays: z.number().int().min(1),
  maxDays: z.number().int().min(1),
  unitPriceHtCents: cents,
});

export const logisticsTierSchema = z.object({
  minUnits: z.number().int().min(1),
  maxUnits: z.number().int().min(1),
  priceHtCents: cents,
});

export const zoneSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  postalCodes: z.array(z.string().regex(/^\d{5}$/)).min(1),
  logistics: z.array(logisticsTierSchema).min(1),
});

export const heatingSizingSchema = z.object({
  /** Puissance électrique d'un appareil de référence (W). */
  unitPowerW: z.number().int().min(500).max(5000),
  /** Tension nominale utilisée pour l'intensité affichée (V). */
  nominalVoltage: z.number().int().min(100).max(400),
  /** W/m² selon isolation, à hauteur de référence. */
  wattsPerM2: z.object({
    bonne: z.number().min(30).max(300),
    moyenne: z.number().min(30).max(300),
    faible: z.number().min(30).max(300),
  }),
  /** Isolation retenue quand le client répond « je ne sais pas » (prudence). */
  unknownInsulationAs: z.enum(["bonne", "moyenne", "faible"]),
  referenceHeightM: z.number().min(2).max(3),
  /** Au-delà : estimation affichée mais bascule en devis manuel. */
  maxHeightM: z.number().min(2.5).max(6),
  /** Seuils déclenchant « étude du site nécessaire ». */
  maxRoomSurfaceM2: z.number().min(10).max(500),
  maxTotalSurfaceM2: z.number().min(20).max(5000),
  maxRooms: z.number().int().min(1).max(100),
  /** Au-delà, une recommandation dans UN logement (appartement/maison) exige une revue humaine. */
  maxUnitsPerDwellingAuto: z.number().int().min(1).max(20),
  /** Quantité maximale saisissable par le client dans l'assistant. */
  maxSelectableUnits: z.number().int().min(1).max(200),
});

export const coolingSizingSchema = z.object({
  /** Fourchette de puissance frigorifique indicative, W froid / m² à hauteur de référence. */
  lowWPerM2: z.number().min(30).max(300),
  highWPerM2: z.number().min(30).max(400),
  exposureFactor: z.object({
    nord: z.number(), est: z.number(), ouest: z.number(), sud: z.number(), inconnue: z.number(),
  }),
  insulationFactor: z.object({
    bonne: z.number(), moyenne: z.number(), faible: z.number(), inconnue: z.number(),
  }),
  extraWPerPersonAbove2: z.number().min(0).max(500),
  referenceHeightM: z.number().min(2).max(3),
});

export const businessSettingsSchema = z.object({
  currency: z.literal("EUR"),
  vatApplicable: z.boolean(),
  /** Taux en points de base : 2000 = 20 %. */
  vatRateBp: z.number().int().min(0).max(5000),
  vatNote: z.string().max(300),
  heating: z.object({
    enabled: z.boolean(),
    rentalTiers: z.array(rentalTierSchema).min(1),
    expressSurchargeHtCents: cents,
    sizing: heatingSizingSchema,
  }),
  cooling: z.object({
    /** false = pré-demande sur devis uniquement (aucun prix affiché). */
    pricingEnabled: z.boolean(),
    sizing: coolingSizingSchema,
  }),
  zones: z.array(zoneSchema).min(1),
  /** Délais / modes indicatifs, purement informatifs (jamais garantis). */
  operations: z.object({
    vehicles: z.array(z.object({ id: z.string(), label: z.string(), maxUnits: z.number().int().min(1) })),
    responseTargetHours: z.number().int().min(1).max(168).nullable(),
    /** Afficher l'objectif de réponse sur le site seulement s'il est validé ET mesuré. */
    showResponseTargetPublicly: z.boolean(),
  }),
  /**
   * Règle de décompte des jours facturables — à choisir UNIQUEMENT une fois les CGL validées.
   * null = non définie : le back-office affiche les dates réelles et « durée facturable à déterminer ».
   *  - calendar_inclusive : jours calendaires (Europe/Paris), jour de remise ET jour de reprise inclus
   *  - started_24h_periods : périodes de 24 h entamées depuis l'heure réelle de remise
   */
  rental: z.object({
    dayCountRule: z.enum(["calendar_inclusive", "started_24h_periods"]).nullable(),
  }).default({ dayCountRule: null }),
  /** Versions des textes juridiques acceptés au moment de la demande. */
  legal: z.object({
    termsVersion: z.string().min(1).max(40),
    privacyVersion: z.string().min(1).max(40),
  }),
});

export type BusinessSettings = z.infer<typeof businessSettingsSchema>;
export type Zone = z.infer<typeof zoneSchema>;
export type Insulation = "bonne" | "moyenne" | "faible" | "inconnue";
