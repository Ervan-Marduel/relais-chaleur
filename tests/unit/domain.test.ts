import { describe, expect, it } from "vitest";
import { defaultBusinessSettings as S } from "@config/business";
import { estimateHeating, quantityWarnings } from "@/lib/domain/heating";
import { estimatePrice, findZone, vatOf } from "@/lib/domain/pricing";
import { estimateCooling } from "@/lib/domain/cooling";
import { checkTransition, TRANSITIONS } from "@/lib/domain/status";
import { businessSettingsSchema } from "@/lib/domain/settings";
import { isValidSiret, requestPayloadSchema } from "@/lib/validation/request";
import { parisLocalToUtc } from "@/lib/format";
import { validPayload } from "../support/fixtures";

describe("configuration métier", () => {
  it("la configuration par défaut est valide", () => {
    expect(() => businessSettingsSchema.parse(S)).not.toThrow();
  });
});

describe("estimation chauffage", () => {
  it("recette 1 : 25 m², 1 pièce, bonne isolation, 2,5 m → 1 appareil 2 000 W", () => {
    const r = estimateHeating({ totalSurfaceM2: 25, rooms: 1, ceilingHeightM: 2.5, insulation: "bonne", placeType: "appartement" }, S);
    expect(r.recommendedUnits).toBe(1);
    expect(r.totalPowerW).toBe(2000);
    expect(r.amperesPerUnit).toBe(8.7);
    expect(r.requiresManualReview).toBe(false);
  });
  it("recette 1 bis : il peut en choisir 2, avec avertissement électrique", () => {
    const w = quantityWarnings(2, 1, S, "appartement");
    expect(w.join(" ")).toMatch(/4 kW/);
    expect(w.join(" ")).toMatch(/même circuit/);
    expect(w.join(" ")).toMatch(/8,7 A/);
  });
  it("isolation moyenne : 20 m² par appareil ; faible : ~16,7 m²", () => {
    expect(estimateHeating({ totalSurfaceM2: 20, rooms: 1, ceilingHeightM: 2.5, insulation: "moyenne", placeType: "maison" }, S).recommendedUnits).toBe(1);
    expect(estimateHeating({ totalSurfaceM2: 21, rooms: 1, ceilingHeightM: 2.5, insulation: "moyenne", placeType: "maison" }, S).recommendedUnits).toBe(2);
    expect(estimateHeating({ totalSurfaceM2: 16, rooms: 1, ceilingHeightM: 2.5, insulation: "faible", placeType: "maison" }, S).recommendedUnits).toBe(1);
    expect(estimateHeating({ totalSurfaceM2: 17, rooms: 1, ceilingHeightM: 2.5, insulation: "faible", placeType: "maison" }, S).recommendedUnits).toBe(2);
  });
  it("calcule par pièce : 2 pièces de 10 m² → 2 appareils (pas 1)", () => {
    const r = estimateHeating({ roomSurfaces: [10, 10], ceilingHeightM: 2.5, insulation: "bonne", placeType: "appartement" }, S);
    expect(r.recommendedUnits).toBe(2);
    expect(r.perRoom.map((p) => p.units)).toEqual([1, 1]);
  });
  it("surface totale répartie : avertissement de précision", () => {
    const r = estimateHeating({ totalSurfaceM2: 40, rooms: 2, ceilingHeightM: 2.5, insulation: "bonne", placeType: "appartement" }, S);
    expect(r.warnings).toContain("surface_repartie");
    expect(r.recommendedUnits).toBe(2);
  });
  it("hauteur 3 m : facteur 1,2 ; hauteur 4 m → devis manuel", () => {
    const r = estimateHeating({ totalSurfaceM2: 25, rooms: 1, ceilingHeightM: 3, insulation: "bonne", placeType: "bureau" }, S);
    expect(r.heightFactor).toBe(1.2);
    expect(r.recommendedUnits).toBe(2);
    expect(r.requiresManualReview).toBe(false);
    const h = estimateHeating({ totalSurfaceM2: 25, rooms: 1, ceilingHeightM: 4, insulation: "bonne", placeType: "bureau" }, S);
    expect(h.warnings).toContain("hauteur_atypique");
    expect(h.requiresManualReview).toBe(true);
  });
  it("ne valide jamais automatiquement 10 appareils dans un même appartement", () => {
    const r = estimateHeating({ roomSurfaces: [25, 25, 25, 25, 25, 25, 25, 25, 25, 25], ceilingHeightM: 2.5, insulation: "bonne", placeType: "appartement" }, S);
    expect(r.recommendedUnits).toBe(10);
    expect(r.requiresManualReview).toBe(true);
    expect(r.warnings).toContain("beaucoup_appareils_logement");
  });
  it("ERP / école : revue manuelle obligatoire", () => {
    const r = estimateHeating({ totalSurfaceM2: 50, rooms: 1, ceilingHeightM: 2.5, insulation: "bonne", placeType: "erp_ecole" }, S);
    expect(r.requiresManualReview).toBe(true);
  });
  it("isolation inconnue : hypothèse prudente (moyenne) signalée", () => {
    const r = estimateHeating({ totalSurfaceM2: 25, rooms: 1, ceilingHeightM: 2.5, insulation: "inconnue", placeType: "maison" }, S);
    expect(r.insulationUsed).toBe("moyenne");
    expect(r.recommendedUnits).toBe(2);
    expect(r.warnings).toContain("isolation_inconnue");
  });
});

describe("tarification chauffage", () => {
  const base = { service: "chauffage" as const, postalCode: "69003", expressRequested: false, multiSite: false, placeType: "appartement" };
  it("recette 3 : 5 radiateurs × 14 jours Lyon = 559 € HT / 670,80 € TTC", () => {
    const r = estimatePrice({ ...base, quantity: 5, estimatedDays: 14 }, S);
    expect(r.mode).toBe("estimate");
    if (r.mode !== "estimate") return;
    expect(r.totalHtCents).toBe(55900);
    expect(r.vatCents).toBe(11180);
    expect(r.totalTtcCents).toBe(67080);
  });
  it("3 radiateurs × 7 jours = 256 € HT", () => {
    const r = estimatePrice({ ...base, quantity: 3, estimatedDays: 7 }, S);
    expect(r.mode === "estimate" && r.totalHtCents).toBe(25600);
  });
  it("Villeurbanne 69100 est dans la zone", () => {
    expect(findZone("69100", S)?.id).toBe("lyon-villeurbanne");
    expect(findZone("69200", S)).toBeNull();
  });
  it("bornes de paliers : 1, 3, 4, 7, 8, 14, 15, 28 jours", () => {
    const unit = (d: number) => {
      const r = estimatePrice({ ...base, quantity: 1, estimatedDays: d }, S);
      return r.mode === "estimate" ? r.lines[0].unitHtCents : null;
    };
    expect([1, 3, 4, 7, 8, 14, 15, 28].map(unit)).toEqual([3900, 3900, 5900, 5900, 8800, 8800, 12900, 12900]);
  });
  it("sur devis : > 28 jours, durée inconnue, hors zone, 9+ appareils, multi-sites, ERP", () => {
    const reasons = (x: Partial<Parameters<typeof estimatePrice>[0]>) => {
      const r = estimatePrice({ ...base, quantity: 2, estimatedDays: 5, ...x }, S);
      return r.mode === "sur_devis" ? r.reasons : [];
    };
    expect(reasons({ estimatedDays: 29 })).toContain("duree_hors_grille");
    expect(reasons({ estimatedDays: null })).toContain("duree_inconnue");
    expect(reasons({ postalCode: "38000" })).toContain("hors_zone");
    expect(reasons({ quantity: 9 })).toContain("quantite_hors_grille");
    expect(reasons({ multiSite: true })).toContain("multi_sites");
    expect(reasons({ placeType: "erp_ecole" })).toContain("erp_ecole");
  });
  it("l'express n'est JAMAIS ajouté au total estimé", () => {
    const a = estimatePrice({ ...base, quantity: 5, estimatedDays: 14 }, S);
    const b = estimatePrice({ ...base, quantity: 5, estimatedDays: 14, expressRequested: true }, S);
    expect(a.mode === "estimate" && b.mode === "estimate" && a.totalHtCents === b.totalHtCents).toBe(true);
    expect(b.expressOptionHtCents).toBe(4500);
  });
  it("climatisation : toujours sur devis, sans prix", () => {
    const r = estimatePrice({ ...base, service: "climatisation", quantity: 1, estimatedDays: 7 }, S);
    expect(r.mode).toBe("sur_devis");
    expect(JSON.stringify(r)).not.toMatch(/totalHtCents/);
  });
  it("TVA non applicable : TTC = HT", () => {
    expect(vatOf(55900, { ...S, vatApplicable: false })).toBe(0);
  });
});

describe("estimation climatisation", () => {
  it("donne une fourchette indicative et des points de faisabilité", () => {
    const r = estimateCooling({ surfaceM2: 20, rooms: 1, ceilingHeightM: 2.5, exposure: "sud", insulation: "moyenne", people: 2, exhaust: "non", noiseSensitive: true, power: "inconnu" }, S);
    expect(r.lowW).toBeGreaterThan(1500);
    expect(r.highW).toBeGreaterThan(r.lowW);
    expect(r.lowBtu).toBeGreaterThan(r.lowW * 3);
    expect(r.feasibilityNotes.join(" ")).toMatch(/évacuer l'air chaud/);
    expect(r.requiresManualReview).toBe(true);
  });
});

describe("statuts", () => {
  const ok = { role: "admin" as const, isErp: false, hasQuote: true, hasDeliverySlot: true, checks: { stock: true, zone: true, electricite: true, devis: true, creneau: true } };
  it("seul un admin peut confirmer, après tous les contrôles", () => {
    expect(checkTransition({ ...ok, from: "devis_a_confirmer", to: "confirmee" })).toBeNull();
    expect(checkTransition({ ...ok, role: "commercial", from: "devis_a_confirmer", to: "confirmee" })).toBe("role_insuffisant");
    expect(checkTransition({ ...ok, checks: { ...ok.checks, stock: false }, from: "devis_a_confirmer", to: "confirmee" })).toBe("controles_incomplets");
    expect(checkTransition({ ...ok, hasQuote: false, from: "devis_a_confirmer", to: "confirmee" })).toBe("devis_requis");
    expect(checkTransition({ ...ok, hasDeliverySlot: false, from: "devis_a_confirmer", to: "confirmee" })).toBe("creneau_requis");
  });
  it("ERP : contrôle supplémentaire requis", () => {
    expect(checkTransition({ ...ok, isErp: true, from: "devis_a_confirmer", to: "confirmee" })).toBe("controles_incomplets");
    expect(checkTransition({ ...ok, isErp: true, checks: { ...ok.checks, erp: true }, from: "devis_a_confirmer", to: "confirmee" })).toBeNull();
  });
  it("on ne saute pas de la nouvelle demande à confirmée", () => {
    expect(TRANSITIONS.nouvelle_demande).not.toContain("confirmee");
    expect(checkTransition({ ...ok, from: "nouvelle_demande", to: "confirmee" })).toBe("transition_interdite");
  });
});

describe("validation", () => {
  it("SIRET : clé de Luhn", () => {
    expect(isValidSiret("73282932000074")).toBe(true);
    expect(isValidSiret("73282932000075")).toBe(false);
    expect(isValidSiret("123")).toBe(false);
  });
  it("refuse un SIRET pour un particulier et exige la raison sociale d'un pro", () => {
    const base = validPayload();
    const r1 = requestPayloadSchema.safeParse({ ...base, customer: { ...base.customer, kind: "particulier", siret: "73282932000074" } });
    expect(r1.success).toBe(false);
    const r2 = requestPayloadSchema.safeParse({ ...base, customer: { ...base.customer, kind: "entreprise", companyName: "" } });
    expect(r2.success).toBe(false);
    expect(requestPayloadSchema.safeParse(base).success).toBe(true);
  });
  it("supprime les caractères de contrôle", () => {
    const base = validPayload();
    const r = requestPayloadSchema.parse({ ...base, notes: "ok\u0000\u0007 suite" });
    expect(r.notes).toBe("ok suite");
  });
});

describe("dates Europe/Paris", () => {
  it("gère heure d'été / heure d'hiver", () => {
    expect(parisLocalToUtc("2026-07-01", "09:00").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(parisLocalToUtc("2026-12-01", "09:00").toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(parisLocalToUtc("2026-10-25", "12:00").toISOString()).toBe("2026-10-25T11:00:00.000Z"); // jour du changement
  });
});


import { rentalDays } from "@/lib/domain/rental-days";
describe("jours de location constatés", () => {
  const del = new Date("2026-10-24T16:00:00Z"); // samedi 18h Paris
  const ret = new Date("2026-10-26T08:00:00Z"); // lundi 9h Paris (changement d'heure le 25)
  it("aucune règle validée → null (on n'invente pas de décompte)", () => {
    expect(rentalDays(del, ret, null)).toBeNull();
  });
  it("jours calendaires inclusifs, robustes au changement d'heure", () => {
    expect(rentalDays(del, ret, "calendar_inclusive")).toBe(3);
  });
  it("périodes de 24 h entamées", () => {
    expect(rentalDays(del, ret, "started_24h_periods")).toBe(2); // 41 h
    expect(rentalDays(new Date("2026-11-01T08:00:00Z"), new Date("2026-11-02T08:00:00Z"), "started_24h_periods")).toBe(1);
  });
  it("refuse une reprise antérieure à la remise", () => {
    expect(() => rentalDays(ret, del, "calendar_inclusive")).toThrow();
  });
});
