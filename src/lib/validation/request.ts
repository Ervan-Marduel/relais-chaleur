import { z } from "zod";

/** Schéma partagé navigateur/serveur. Le SERVEUR re-valide toujours et recalcule tous les prix. */

// Supprime les caractères de contrôle (sauf saut de ligne dans les notes) et normalise les espaces.
const clean = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim())
    .pipe(z.string().max(max));
const req = (max: number, msg = "Champ obligatoire") => clean(max).pipe(z.string().min(1, msg));
const opt = (max: number) => clean(max).optional().transform((v) => (v ? v : undefined));

export const postalCodeSchema = z.string().trim().regex(/^\d{5}$/, "Code postal à 5 chiffres");
const phone = clean(30).pipe(
  z.string().refine((v) => {
    const d = v.replace(/\D/g, "");
    return /^\+?[0-9 .()-]+$/.test(v) && d.length >= 9 && d.length <= 15;
  }, "Numéro de téléphone invalide"),
);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide").refine((v) => !Number.isNaN(Date.parse(v + "T12:00:00Z")), "Date invalide");

export function isValidSiret(v: string) {
  const s = v.replace(/\s/g, "");
  if (!/^\d{14}$/.test(s)) return false;
  // La Poste (SIREN 356000000) : règle spécifique — somme des chiffres multiple de 5
  if (s.startsWith("356000000")) return [...s].reduce((a, c) => a + Number(c), 0) % 5 === 0;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let n = Number(s[13 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export const CLIENT_KINDS = ["particulier", "entreprise", "syndic", "autre"] as const;
export const PLACE_TYPES = ["appartement", "maison", "bureau", "commerce", "copropriete", "local", "erp_ecole"] as const;
export const PLACE_LABEL: Record<(typeof PLACE_TYPES)[number], string> = {
  appartement: "Appartement",
  maison: "Maison",
  bureau: "Bureau",
  commerce: "Commerce",
  copropriete: "Copropriété (parties communes / plusieurs lots)",
  local: "Local particulier (atelier, réserve, chantier…)",
  erp_ecole: "ERP / école (traitement séparé)",
};
export const CLIENT_KIND_LABEL: Record<(typeof CLIENT_KINDS)[number], string> = {
  particulier: "Particulier",
  entreprise: "Entreprise / professionnel",
  syndic: "Syndic / gestionnaire / bailleur",
  autre: "Autre (association, collectivité…)",
};

const yesNoUnknown = z.enum(["oui", "non", "inconnu"]);

export const heatingNeedSchema = z
  .object({
    surfaceMode: z.enum(["total", "detail"]),
    totalSurfaceM2: z.number().min(1).max(5000).optional(),
    rooms: z.number().int().min(1).max(100).optional(),
    roomSurfaces: z.array(z.number().min(1).max(1000)).max(100).optional(),
    ceilingHeightM: z.number().min(1.8).max(12),
    insulation: z.enum(["bonne", "moyenne", "faible", "inconnue"]),
    quantityRequested: z.number().int().min(1).max(200),
  })
  .superRefine((v, ctx) => {
    if (v.surfaceMode === "detail" && !(v.roomSurfaces && v.roomSurfaces.length > 0))
      ctx.addIssue({ code: "custom", message: "Indiquez la surface d'au moins une pièce", path: ["roomSurfaces"] });
    if (v.surfaceMode === "total" && (v.totalSurfaceM2 == null || v.rooms == null))
      ctx.addIssue({ code: "custom", message: "Surface totale et nombre de pièces requis", path: ["totalSurfaceM2"] });
  });

export const coolingNeedSchema = z.object({
  surfaceM2: z.number().min(1).max(5000),
  rooms: z.number().int().min(1).max(100),
  ceilingHeightM: z.number().min(1.8).max(12),
  exposure: z.enum(["nord", "est", "ouest", "sud", "inconnue"]),
  insulation: z.enum(["bonne", "moyenne", "faible", "inconnue"]),
  people: z.number().int().min(0).max(500).nullable().optional(),
  exhaust: z.enum(["fenetre", "ouverture_murale", "non", "inconnu"]),
  noiseSensitive: z.boolean(),
  power: yesNoUnknown,
});

const addressSchema = z.object({
  line1: req(200, "Numéro et rue obligatoires"),
  line2: opt(200),
  postalCode: postalCodeSchema,
  city: req(100, "Commune obligatoire"),
});

export const requestPayloadSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    service: z.enum(["chauffage", "climatisation"]),
    heating: heatingNeedSchema.optional(),
    cooling: coolingNeedSchema.optional(),
    site: z.object({
      placeType: z.enum(PLACE_TYPES),
      floor: opt(40),
      elevator: yesNoUnknown,
      parking: opt(300),
      multiSite: z.boolean(),
      siteCount: z.number().int().min(2).max(500).nullable().optional(),
      multiSiteDetails: opt(2000),
    }),
    schedule: z.object({
      desiredStartDate: isoDate,
      durationUnknown: z.boolean(),
      estimatedDays: z.number().int().min(1).max(365).nullable().optional(),
      plannedReturnDate: isoDate.optional().or(z.literal("").transform(() => undefined)),
      expressRequested: z.boolean(),
    }),
    customer: z.object({
      kind: z.enum(CLIENT_KINDS),
      companyName: opt(200),
      siret: opt(20),
      contactName: req(120, "Nom du contact obligatoire"),
      phone,
      email: clean(160).pipe(z.string().email("Email invalide")),
      billingAddress: addressSchema.optional(),
      customerReference: opt(80),
    }),
    delivery: z.object({
      recipientName: req(120, "Nom du réceptionnaire obligatoire"),
      recipientPhone: phone,
      address: addressSchema,
      accessInstructions: opt(1000),
      preferredHours: opt(300),
    }),
    notes: opt(2000),
    consent: z.object({
      terms: z.literal(true, { message: "Acceptation requise" }),
      privacy: z.literal(true, { message: "Acceptation requise" }),
      termsVersion: z.string().max(40),
      privacyVersion: z.string().max(40),
    }),
    attribution: z
      .object({
        utmSource: opt(100), utmMedium: opt(100), utmCampaign: opt(150), utmTerm: opt(150), utmContent: opt(150),
        landingPath: opt(200), referrerHost: opt(200),
      })
      .optional(),
    // Anti-spam
    website: z.string().max(200).optional(), // honeypot : doit rester vide
    startedAt: z.number().int().optional(),
    turnstileToken: z.string().max(4096).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.service === "chauffage" && !v.heating) ctx.addIssue({ code: "custom", message: "Besoin chauffage manquant", path: ["heating"] });
    if (v.service === "climatisation" && !v.cooling) ctx.addIssue({ code: "custom", message: "Besoin climatisation manquant", path: ["cooling"] });
    if (!v.schedule.durationUnknown && v.schedule.estimatedDays == null)
      ctx.addIssue({ code: "custom", message: "Indiquez une durée estimée ou « durée inconnue »", path: ["schedule", "estimatedDays"] });
    const pro = v.customer.kind !== "particulier";
    if (pro && !v.customer.companyName)
      ctx.addIssue({ code: "custom", message: "Raison sociale obligatoire pour un professionnel", path: ["customer", "companyName"] });
    if (v.customer.siret) {
      if (!pro) ctx.addIssue({ code: "custom", message: "Le SIRET ne concerne que les professionnels", path: ["customer", "siret"] });
      else if (!isValidSiret(v.customer.siret))
        ctx.addIssue({ code: "custom", message: "SIRET invalide (14 chiffres)", path: ["customer", "siret"] });
    }
    if (v.schedule.plannedReturnDate && v.schedule.plannedReturnDate < v.schedule.desiredStartDate)
      ctx.addIssue({ code: "custom", message: "La reprise prévue doit suivre la date de début", path: ["schedule", "plannedReturnDate"] });
    if (v.site.multiSite && !v.site.siteCount)
      ctx.addIssue({ code: "custom", message: "Indiquez le nombre de logements / sites", path: ["site", "siteCount"] });
  });

export type RequestPayload = z.infer<typeof requestPayloadSchema>;
export type RequestPayloadInput = z.input<typeof requestPayloadSchema>;

export const estimateQuerySchema = z.object({
  service: z.enum(["chauffage", "climatisation"]),
  heating: heatingNeedSchema.optional(),
  cooling: coolingNeedSchema.optional(),
  placeType: z.enum(PLACE_TYPES),
  postalCode: postalCodeSchema.optional(),
  durationUnknown: z.boolean().optional(),
  estimatedDays: z.number().int().min(1).max(365).nullable().optional(),
  expressRequested: z.boolean().optional(),
  multiSite: z.boolean().optional(),
  /** « recommended » : le serveur utilise la quantité recommandée pour le prix. */
  quantityMode: z.enum(["recommended", "explicit"]).optional(),
});
