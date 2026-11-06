import type { RequestPayloadInput } from "@/lib/validation/request";

export type Insul = "bonne" | "moyenne" | "faible" | "inconnue";

export type Draft = {
  v: 2;
  idempotencyKey: string;
  startedAt: number;
  step: number;
  service: "chauffage" | "climatisation" | null;
  h: { surfaceMode: "total" | "detail"; totalSurface: string; rooms: string; roomSurfaces: string[]; heightMode: "standard" | "custom"; height: string; insulation: Insul | ""; quantity: number | null };
  c: { surface: string; rooms: string; height: string; exposure: "nord" | "est" | "ouest" | "sud" | "inconnue" | ""; insulation: Insul | ""; people: string; exhaust: "fenetre" | "ouverture_murale" | "non" | "inconnu" | ""; noise: boolean; power: "oui" | "non" | "inconnu" | "" };
  site: { placeType: string; floor: string; elevator: "oui" | "non" | "inconnu" | ""; parking: string; multiSite: boolean; siteCount: string; multiSiteDetails: string };
  sched: { start: string; durationUnknown: boolean; days: string; returnDate: string; express: boolean };
  cust: { kind: "particulier" | "entreprise" | "syndic" | "autre" | ""; companyName: string; siret: string; contactName: string; phone: string; email: string; ref: string; billing: boolean; b1: string; b2: string; bpc: string; bcity: string };
  deliv: { sameAsContact: boolean; recipientName: string; recipientPhone: string; line1: string; line2: string; postalCode: string; city: string; access: string; hours: string };
  notes: string;
  terms: boolean;
  privacy: boolean;
};

export const DRAFT_KEY = "rc_demande_brouillon_v2";

export function newDraft(): Draft {
  return {
    v: 2,
    idempotencyKey: crypto.randomUUID(),
    startedAt: Date.now(),
    step: 0,
    service: null,
    h: { surfaceMode: "total", totalSurface: "", rooms: "1", roomSurfaces: ["", ""], heightMode: "standard", height: "", insulation: "", quantity: null },
    c: { surface: "", rooms: "1", height: "", exposure: "", insulation: "", people: "", exhaust: "", noise: false, power: "" },
    site: { placeType: "", floor: "", elevator: "", parking: "", multiSite: false, siteCount: "", multiSiteDetails: "" },
    sched: { start: "", durationUnknown: false, days: "", returnDate: "", express: false },
    cust: { kind: "", companyName: "", siret: "", contactName: "", phone: "", email: "", ref: "", billing: false, b1: "", b2: "", bpc: "", bcity: "" },
    deliv: { sameAsContact: false, recipientName: "", recipientPhone: "", line1: "", line2: "", postalCode: "", city: "", access: "", hours: "" },
    notes: "",
    terms: false,
    privacy: false,
  };
}

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d && d.v === 2 ? d : null;
  } catch {
    return null;
  }
}
export function saveDraft(d: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch { /* stockage indisponible : la saisie reste en mémoire */ }
}
export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch { /* ignore */ }
}

export const num = (s: string) => {
  const n = Number(String(s).replace(",", ".").trim());
  return s.trim() === "" || !Number.isFinite(n) ? NaN : n;
};

export function heightOf(d: Draft, refH: number) {
  return d.h.heightMode === "standard" ? refH : num(d.h.height);
}

export function heatingNeed(d: Draft, refH: number, quantity: number) {
  return {
    surfaceMode: d.h.surfaceMode,
    totalSurfaceM2: d.h.surfaceMode === "total" ? num(d.h.totalSurface) : undefined,
    rooms: d.h.surfaceMode === "total" ? Math.floor(num(d.h.rooms)) : undefined,
    roomSurfaces: d.h.surfaceMode === "detail" ? d.h.roomSurfaces.map(num).filter((x) => x > 0) : undefined,
    ceilingHeightM: heightOf(d, refH),
    insulation: (d.h.insulation || "inconnue") as Insul,
    quantityRequested: quantity,
  };
}

export function coolingNeed(d: Draft) {
  return {
    surfaceM2: num(d.c.surface),
    rooms: Math.floor(num(d.c.rooms)),
    ceilingHeightM: d.c.height ? num(d.c.height) : 2.5,
    exposure: (d.c.exposure || "inconnue") as "nord" | "est" | "ouest" | "sud" | "inconnue",
    insulation: (d.c.insulation || "inconnue") as Insul,
    people: d.c.people ? Math.floor(num(d.c.people)) : null,
    exhaust: (d.c.exhaust || "inconnu") as "fenetre" | "ouverture_murale" | "non" | "inconnu",
    noiseSensitive: d.c.noise,
    power: (d.c.power || "inconnu") as "oui" | "non" | "inconnu",
  };
}

export function buildPayload(d: Draft, o: { refH: number; quantity: number; termsVersion: string; privacyVersion: string; attribution?: Record<string, string>; website: string; turnstileToken?: string }): RequestPayloadInput {
  const pro = d.cust.kind !== "particulier";
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);
  return {
    idempotencyKey: d.idempotencyKey,
    service: d.service!,
    heating: d.service === "chauffage" ? heatingNeed(d, o.refH, o.quantity) : undefined,
    cooling: d.service === "climatisation" ? coolingNeed(d) : undefined,
    site: {
      placeType: d.site.placeType as RequestPayloadInput["site"]["placeType"],
      floor: opt(d.site.floor),
      elevator: (d.site.elevator || "inconnu") as "oui" | "non" | "inconnu",
      parking: opt(d.site.parking),
      multiSite: d.site.multiSite,
      siteCount: d.site.multiSite ? Math.floor(num(d.site.siteCount)) || null : null,
      multiSiteDetails: d.site.multiSite ? opt(d.site.multiSiteDetails) : undefined,
    },
    schedule: {
      desiredStartDate: d.sched.start,
      durationUnknown: d.sched.durationUnknown,
      estimatedDays: d.sched.durationUnknown ? null : Math.floor(num(d.sched.days)),
      plannedReturnDate: d.sched.returnDate || undefined,
      expressRequested: d.sched.express,
    },
    customer: {
      kind: d.cust.kind as "particulier",
      companyName: pro ? opt(d.cust.companyName) : undefined,
      siret: pro ? opt(d.cust.siret.replace(/\s/g, "")) : undefined,
      contactName: d.cust.contactName,
      phone: d.cust.phone,
      email: d.cust.email,
      customerReference: opt(d.cust.ref),
      billingAddress: d.cust.billing ? { line1: d.cust.b1, line2: opt(d.cust.b2), postalCode: d.cust.bpc, city: d.cust.bcity } : undefined,
    },
    delivery: {
      recipientName: d.deliv.sameAsContact ? d.cust.contactName : d.deliv.recipientName,
      recipientPhone: d.deliv.sameAsContact ? d.cust.phone : d.deliv.recipientPhone,
      address: { line1: d.deliv.line1, line2: opt(d.deliv.line2), postalCode: d.deliv.postalCode, city: d.deliv.city },
      accessInstructions: opt(d.deliv.access),
      preferredHours: opt(d.deliv.hours),
    },
    notes: opt(d.notes),
    consent: { terms: d.terms as true, privacy: d.privacy as true, termsVersion: o.termsVersion, privacyVersion: o.privacyVersion },
    attribution: o.attribution,
    website: o.website,
    startedAt: d.startedAt,
    turnstileToken: o.turnstileToken,
  };
}
