"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HEATING_WARNING_TEXT, type HeatingEstimate } from "@/lib/domain/heating";
import { QUOTE_REASON_TEXT, type PriceEstimate } from "@/lib/domain/pricing";
import type { CoolingEstimate } from "@/lib/domain/cooling";
import { CLIENT_KIND_LABEL, isValidSiret, PLACE_LABEL, PLACE_TYPES } from "@/lib/validation/request";
import { formatEuros, formatIsoDate, todayInParis } from "@/lib/format";
import { captureAttribution, getAttribution, track } from "../Track";
import { buildPayload, clearDraft, coolingNeed, heatingNeed, loadDraft, newDraft, num, saveDraft, type Draft } from "./draft";

type Config = {
  termsVersion: string;
  privacyVersion: string;
  maxSelectableUnits: number;
  unitPowerW: number;
  voltage: number;
  referenceHeightM: number;
  turnstileSiteKey: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  settingsAvailable: boolean;
};
type Initial = { service?: "chauffage" | "climatisation"; surface?: string; rooms?: string; insulation?: string; multi?: boolean };

type EstimateResponse = {
  ok: true;
  heating: HeatingEstimate | null;
  cooling: CoolingEstimate | null;
  quantity: number;
  quantityWarnings: string[];
  price: PriceEstimate;
  requiresManualReview: boolean;
  postalCodeKnown: boolean;
  vatApplicable: boolean;
};

const STEPS = ["Besoin", "Votre espace", "Le lieu", "Recommandation", "Dates et zone", "Coordonnées", "Récapitulatif"];
type Errors = Record<string, string>;

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void } }
}

export default function Wizard({ initial, config }: { initial: Initial; config: Config }) {
  const [d, setD] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [est, setEst] = useState<EstimateResponse | null>(null);
  const [estErr, setEstErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ reference: string; quoteMode: string } | null>(null);
  const [restored, setRestored] = useState(false);
  const honeypot = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>();
  const refH = config.referenceHeightM;

  // Chargement : brouillon local éventuel, puis paramètres d'URL.
  // Lecture de localStorage possible uniquement côté navigateur, après hydratation : setState ici est voulu.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    captureAttribution();
    const saved = loadDraft();
    const base = saved ?? newDraft();
    if (saved && saved.step > 0) setRestored(true);
    if (!saved || saved.step === 0) {
      if (initial.service) base.service = initial.service;
      if (initial.surface && /^\d+([.,]\d+)?$/.test(initial.surface)) base.h.totalSurface = initial.surface;
      if (initial.rooms && /^\d+$/.test(initial.rooms)) base.h.rooms = initial.rooms;
      if (initial.insulation && ["bonne", "moyenne", "faible", "inconnue"].includes(initial.insulation)) base.h.insulation = initial.insulation as Draft["h"]["insulation"];
      if (initial.multi) { base.site.multiSite = true; base.site.placeType = base.site.placeType || "copropriete"; }
    }
    setD(base);
  }, [initial]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (d && !success) saveDraft(d);
  }, [d, success]);

  const up = useCallback(<K extends keyof Draft>(k: K, v: Partial<Draft[K]> | Draft[K]) => {
    setD((prev) => (prev ? { ...prev, [k]: typeof v === "object" && v !== null && !Array.isArray(v) ? { ...(prev[k] as object), ...v } : v } : prev));
  }, []);

  const cool = d?.service === "climatisation";
  const quantity = d ? d.h.quantity ?? est?.heating?.recommendedUnits ?? 1 : 1;

  // Estimation serveur (quantité recommandée + prix)
  const fetchEstimate = useCallback(async (draft: Draft, qty: number | null) => {
    setEstErr(null);
    try {
      const pc = draft.deliv.postalCode || "";
      const body = {
        service: draft.service,
        placeType: draft.site.placeType || "appartement",
        heating: draft.service === "chauffage" ? heatingNeed(draft, refH, qty ?? 1) : undefined,
        cooling: draft.service === "climatisation" ? coolingNeed(draft) : undefined,
        postalCode: /^\d{5}$/.test(pc) ? pc : undefined,
        durationUnknown: draft.sched.durationUnknown || !draft.sched.days,
        estimatedDays: draft.sched.durationUnknown || !draft.sched.days ? null : Math.floor(num(draft.sched.days)) || null,
        expressRequested: draft.sched.express,
        multiSite: draft.site.multiSite,
        quantityMode: qty == null ? "recommended" : "explicit",
      };
      const r = await fetch("/api/estimate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message ?? "Estimation indisponible");
      setEst(j as EstimateResponse);
    } catch (e) {
      setEstErr((e as Error).message || "Estimation indisponible");
    }
  }, [refH]);

  const estKey = d ? JSON.stringify([d.service, d.h, d.c, d.site.placeType, d.site.multiSite, d.sched, d.deliv.postalCode]) : "";
  useEffect(() => {
    if (!d || d.step < 3 || success) return;
    const t = setTimeout(() => void fetchEstimate(d, d.h.quantity), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estKey, d?.step, success]);

  useEffect(() => {
    if (d && d.step === 3) track("estimate_shown", d.service ?? undefined);
    if (d && d.step === 1) track("start_estimator", d.service ?? undefined);
    headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.step]);

  // Turnstile (si configuré) à la dernière étape
  useEffect(() => {
    if (!config.turnstileSiteKey || d?.step !== 6 || !turnstileRef.current) return;
    const render = () => window.turnstile?.render(turnstileRef.current!, { sitekey: config.turnstileSiteKey, action: "preorder", callback: (t: string) => setTurnstileToken(t), language: "fr" });
    if (window.turnstile) { render(); return; }
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [config.turnstileSiteKey, d?.step]);

  if (!d) return <div className="wizard"><p>Chargement de l&apos;assistant…</p></div>;

  // ───────── Validation par étape (le serveur re-valide tout) ─────────
  function validate(step: number): Errors {
    const e: Errors = {};
    const D = d!;
    if (step === 0 && !D.service) e.service = "Choisissez chauffage ou climatisation.";
    if (step === 1) {
      if (D.service === "chauffage") {
        if (D.h.surfaceMode === "total") {
          const s = num(D.h.totalSurface);
          if (!(s >= 1 && s <= 5000)) e.totalSurface = "Indiquez une surface entre 1 et 5 000 m².";
          const r = num(D.h.rooms);
          if (!(Number.isInteger(r) && r >= 1 && r <= 100)) e.rooms = "Indiquez un nombre de pièces (1 à 100).";
        } else {
          const vals = D.h.roomSurfaces.map(num).filter((x) => !Number.isNaN(x));
          if (vals.length === 0) e.roomSurfaces = "Indiquez la surface d'au moins une pièce.";
          if (vals.some((x) => !(x >= 1 && x <= 1000))) e.roomSurfaces = "Chaque pièce doit faire entre 1 et 1 000 m².";
        }
        if (D.h.heightMode === "custom") {
          const h = num(D.h.height);
          if (!(h >= 1.8 && h <= 12)) e.height = "Hauteur entre 1,80 et 12 m.";
        }
        if (!D.h.insulation) e.insulation = "Choisissez une option (ou « je ne sais pas »).";
      } else {
        const s = num(D.c.surface);
        if (!(s >= 1 && s <= 5000)) e.csurface = "Indiquez une surface entre 1 et 5 000 m².";
        const r = num(D.c.rooms);
        if (!(Number.isInteger(r) && r >= 1)) e.crooms = "Indiquez un nombre de pièces.";
        if (D.c.height && !(num(D.c.height) >= 1.8 && num(D.c.height) <= 12)) e.cheight = "Hauteur entre 1,80 et 12 m.";
        if (!D.c.exposure) e.exposure = "Choisissez une exposition (ou « je ne sais pas »).";
        if (!D.c.insulation) e.cinsulation = "Choisissez une option.";
        if (!D.c.exhaust) e.exhaust = "Indiquez la possibilité d'évacuation.";
        if (!D.c.power) e.power = "Indiquez si une prise est disponible.";
      }
    }
    if (step === 2) {
      if (!D.site.placeType) e.placeType = "Choisissez le type de lieu.";
      if (D.site.multiSite && !(num(D.site.siteCount) >= 2)) e.siteCount = "Indiquez le nombre de logements / sites (2 ou plus).";
    }
    if (step === 4) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(D.sched.start)) e.start = "Indiquez une date de début souhaitée.";
      else if (D.sched.start < todayInParis()) e.start = "La date doit être aujourd'hui ou plus tard.";
      if (!D.sched.durationUnknown) {
        const n = num(D.sched.days);
        if (!(Number.isInteger(n) && n >= 1 && n <= 365)) e.days = "Indiquez une durée en jours (1 à 365) ou cochez « durée inconnue ».";
      }
      if (D.sched.returnDate && D.sched.start && D.sched.returnDate < D.sched.start) e.returnDate = "La reprise doit suivre la date de début.";
      if (!/^\d{5}$/.test(D.deliv.postalCode)) e.postalCode = "Code postal à 5 chiffres.";
    }
    if (step === 5) {
      if (!D.cust.kind) e.kind = "Choisissez le type de client.";
      const pro = D.cust.kind && D.cust.kind !== "particulier";
      if (pro && !D.cust.companyName.trim()) e.companyName = "Raison sociale obligatoire pour un professionnel.";
      if (pro && D.cust.siret.trim() && !isValidSiret(D.cust.siret)) e.siret = "SIRET invalide (14 chiffres).";
      if (!D.cust.contactName.trim()) e.contactName = "Nom du contact obligatoire.";
      if (D.cust.phone.replace(/\D/g, "").length < 9) e.phone = "Téléphone invalide.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(D.cust.email.trim())) e.email = "Email invalide.";
      if (D.cust.billing) {
        if (!D.cust.b1.trim()) e.b1 = "Adresse de facturation obligatoire.";
        if (!/^\d{5}$/.test(D.cust.bpc)) e.bpc = "Code postal à 5 chiffres.";
        if (!D.cust.bcity.trim()) e.bcity = "Commune obligatoire.";
      }
      if (!D.deliv.sameAsContact) {
        if (!D.deliv.recipientName.trim()) e.recipientName = "Nom du réceptionnaire obligatoire.";
        if (D.deliv.recipientPhone.replace(/\D/g, "").length < 9) e.recipientPhone = "Téléphone du réceptionnaire invalide.";
      }
      if (!D.deliv.line1.trim()) e.line1 = "Numéro et rue obligatoires.";
      if (!/^\d{5}$/.test(D.deliv.postalCode)) e.dpostalCode = "Code postal à 5 chiffres.";
      if (!D.deliv.city.trim()) e.city = "Commune obligatoire.";
    }
    if (step === 6) {
      if (!D.terms) e.terms = "Veuillez accepter les conditions.";
      if (!D.privacy) e.privacy = "Veuillez prendre connaissance de la politique de confidentialité.";
      if (config.turnstileSiteKey && !turnstileToken) e.turnstile = "Merci de valider la vérification anti-robot.";
    }
    return e;
  }

  function go(next: number) {
    if (next > d!.step) {
      const e = validate(d!.step);
      setErrors(e);
      if (Object.keys(e).length) {
        setTimeout(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(), 0);
        return;
      }
      if (d!.step === 0) track("start_request", d!.service ?? undefined);
    } else setErrors({});
    setSubmitError(null);
    setD({ ...d!, step: next });
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    const e = validate(6);
    setErrors(e);
    if (Object.keys(e).length) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = buildPayload(d!, {
        refH, quantity, termsVersion: config.termsVersion, privacyVersion: config.privacyVersion,
        attribution: getAttribution(), website: honeypot.current?.value ?? "", turnstileToken,
      });
      const r = await fetch("/api/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      let j: { ok?: boolean; reference?: string; quoteMode?: string; message?: string; issues?: { path: string; message: string }[] } = {};
      try { j = await r.json(); } catch { /* réponse non JSON */ }
      if (r.ok && j.ok && j.reference) {
        setSuccess({ reference: j.reference, quoteMode: j.quoteMode ?? "" });
        clearDraft();
        window.scrollTo({ top: 0 });
        return;
      }
      if (r.status === 422 && j.issues?.length) {
        setSubmitError(`Certains champs sont à corriger : ${j.issues.map((i) => i.message).slice(0, 4).join(" · ")}`);
      } else {
        setSubmitError(j.message ?? "Votre demande n'a pas pu être enregistrée. Vos informations sont conservées sur cet appareil : réessayez dans quelques instants.");
      }
      if (config.turnstileSiteKey) { window.turnstile?.reset(); setTurnstileToken(undefined); }
    } catch {
      setSubmitError("Connexion impossible : votre demande n'a pas été envoyée. Vos informations sont conservées sur cet appareil ; vérifiez votre connexion et réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  // ───────── Rendu ─────────
  if (success) {
    return (
      <div className="wizard">
        <div className="panel success" role="status" aria-live="polite">
          <p className="eyebrow">Demande enregistrée</p>
          <h1 ref={headingRef} tabIndex={-1} style={{ fontSize: "1.8rem" }}>Votre demande n° <span className="ref">{success.reference}</span> est bien reçue.</h1>
          <p className="lead">Notre équipe vous recontactera pour confirmer la disponibilité, le prix et le créneau. <strong>Aucun paiement n&apos;a été effectué.</strong></p>
          <div className="notice info">
            <p>Un accusé de réception est envoyé à l&apos;adresse indiquée. S&apos;il n&apos;arrive pas, vérifiez vos courriers indésirables ; votre demande est enregistrée dans tous les cas.</p>
            <p>Cette demande ne vaut pas confirmation : la location n&apos;est ferme qu&apos;après notre retour.{success.quoteMode === "sur_devis" ? " Le prix vous sera communiqué sur devis." : ""}</p>
          </div>
          {(config.contactEmail || config.contactPhone) && (
            <p className="small" style={{ marginTop: 14 }}>Une question ? {config.contactEmail && <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>}{config.contactPhone && <> · <a href={`tel:${config.contactPhone.replace(/\s/g, "")}`}>{config.contactPhone}</a></>} — rappelez la référence {success.reference}.</p>
          )}
          <div className="btn-row" style={{ marginTop: 18 }}>
            <Link className="btn secondary" href="/">Retour à l&apos;accueil</Link>
          </div>
        </div>
      </div>
    );
  }

  const step = d.step;
  const inv = (k: string) => (errors[k] ? { "aria-invalid": true as const, "aria-describedby": `err-${k}` } : {});
  const pro = d.cust.kind !== "" && d.cust.kind !== "particulier";

  return (
    <div className={`wizard ${cool ? "cool" : ""}`}>
      <p className="eyebrow">{cool ? "Climatisation mobile — pré-demande sur devis" : "Demande de précommande / estimation sans paiement"}</p>
      <div className="progress" aria-hidden="true">{STEPS.map((s, i) => <span key={s} className={i <= step ? "done" : ""} />)}</div>
      <p className="step-meta">Étape {step + 1} sur {STEPS.length} — {STEPS[step]}</p>
      {restored && step > 0 && (
        <div className="notice info" style={{ marginBottom: 14 }}>
          <p>Nous avons retrouvé votre saisie en cours sur cet appareil (rien n&apos;a encore été envoyé). <button type="button" className="btn ghost small" onClick={() => { clearDraft(); setRestored(false); setEst(null); setD(newDraft()); }}>Recommencer</button></p>
        </div>
      )}
      {Object.keys(errors).length > 0 && (
        <div className="notice danger" role="alert" style={{ marginBottom: 14 }}>
          <p><strong>Merci de corriger :</strong></p>
          <ul>{Object.values(errors).map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      <form className="panel" noValidate onSubmit={(e) => { e.preventDefault(); if (step < 6) go(step + 1); else void submit(); }}>
        <h1 ref={headingRef} tabIndex={-1} style={{ fontSize: "1.5rem", fontFamily: "var(--font)", fontWeight: 800 }}>
          {[
            "De quoi avez-vous besoin ?",
            cool ? "Décrivez l'espace à rafraîchir" : "Quelle surface souhaitez-vous chauffer ?",
            "Où se trouve le lieu ?",
            cool ? "Puissance frigorifique indicative" : "Notre recommandation indicative",
            "Quand, et où livrer ?",
            "Vos coordonnées et la réception",
            "Vérifiez et envoyez votre demande",
          ][step]}
        </h1>

        {step === 0 && (
          <fieldset>
            <legend className="sr-only">Service</legend>
            <div className="options">
              <label className="option"><input type="radio" name="service" checked={d.service === "chauffage"} onChange={() => up("service", "chauffage")} {...inv("service")} /><span>J&apos;ai besoin de chauffage<small>Radiateurs à bain d&apos;huile 2 000 W</small></span></label>
              <label className="option cool"><input type="radio" name="service" checked={d.service === "climatisation"} onChange={() => up("service", "climatisation")} /><span>J&apos;ai besoin de climatisation<small>Sur devis — disponibilité à confirmer</small></span></label>
            </div>
            <ErrorText k="service" errors={errors} />
            <p className="small muted" style={{ marginTop: 14 }}>Vous obtiendrez une estimation avant de donner vos coordonnées. Rien n&apos;est envoyé avant la dernière étape.</p>
          </fieldset>
        )}

        {step === 1 && !cool && (
          <>
            <fieldset>
              <legend>Comment décrire la surface ?</legend>
              <div className="options">
                <label className="option"><input type="radio" name="smode" checked={d.h.surfaceMode === "total"} onChange={() => up("h", { surfaceMode: "total" })} /><span>Surface totale + nombre de pièces<small>Rapide, précision limitée</small></span></label>
                <label className="option"><input type="radio" name="smode" checked={d.h.surfaceMode === "detail"} onChange={() => up("h", { surfaceMode: "detail" })} /><span>Pièce par pièce<small>Recommandé, plus précis</small></span></label>
              </div>
            </fieldset>
            {d.h.surfaceMode === "total" ? (
              <div className="row-2">
                <label className="field"><span className="label">Surface totale à chauffer (m²)</span>
                  <input type="number" inputMode="decimal" min={1} max={5000} step="any" value={d.h.totalSurface} onChange={(e) => up("h", { totalSurface: e.target.value })} {...inv("totalSurface")} />
                  <ErrorText k="totalSurface" errors={errors} /></label>
                <label className="field"><span className="label">Nombre de pièces concernées</span>
                  <input type="number" inputMode="numeric" min={1} max={100} value={d.h.rooms} onChange={(e) => up("h", { rooms: e.target.value })} {...inv("rooms")} />
                  <span className="hint">Pièces fermées à chauffer séparément.</span><ErrorText k="rooms" errors={errors} /></label>
              </div>
            ) : (
              <fieldset>
                <legend>Surface de chaque pièce (m²)</legend>
                <div className="room-list">
                  {d.h.roomSurfaces.map((v, i) => (
                    <div className="room-row" key={i}>
                      <label className="field" style={{ margin: 0 }}><span className="label small">Pièce {i + 1}</span>
                        <input type="number" inputMode="decimal" min={1} max={1000} step="any" value={v} onChange={(e) => { const a = [...d.h.roomSurfaces]; a[i] = e.target.value; up("h", { roomSurfaces: a }); }} {...(i === 0 ? inv("roomSurfaces") : {})} /></label>
                      <button type="button" className="btn ghost small" aria-label={`Retirer la pièce ${i + 1}`} disabled={d.h.roomSurfaces.length <= 1} onClick={() => up("h", { roomSurfaces: d.h.roomSurfaces.filter((_, j) => j !== i) })}>Retirer</button>
                    </div>
                  ))}
                </div>
                <ErrorText k="roomSurfaces" errors={errors} />
                <button type="button" className="btn ghost small" style={{ marginTop: 10 }} disabled={d.h.roomSurfaces.length >= 30} onClick={() => up("h", { roomSurfaces: [...d.h.roomSurfaces, ""] })}>+ Ajouter une pièce</button>
              </fieldset>
            )}
            <fieldset>
              <legend>Hauteur sous plafond</legend>
              <div className="options">
                <label className="option"><input type="radio" name="hmode" checked={d.h.heightMode === "standard"} onChange={() => up("h", { heightMode: "standard" })} /><span>Standard (≤ 2,50 m)</span></label>
                <label className="option"><input type="radio" name="hmode" checked={d.h.heightMode === "custom"} onChange={() => up("h", { heightMode: "custom" })} /><span>Plus haut : je précise</span></label>
              </div>
              {d.h.heightMode === "custom" && (
                <label className="field" style={{ marginTop: 10 }}><span className="label">Hauteur (m)</span>
                  <input type="number" inputMode="decimal" min={1.8} max={12} step="0.05" value={d.h.height} onChange={(e) => up("h", { height: e.target.value })} {...inv("height")} /><ErrorText k="height" errors={errors} /></label>
              )}
            </fieldset>
            <fieldset>
              <legend>Isolation approximative</legend>
              <div className="options">
                {([["bonne", "Bonne", "Récente ou rénovée"], ["moyenne", "Moyenne", ""], ["faible", "Faible / ancienne", "Simple vitrage, murs non isolés"], ["inconnue", "Je ne sais pas", "Hypothèse prudente"]] as const).map(([v, l, h]) => (
                  <label key={v} className="option"><input type="radio" name="insulation" checked={d.h.insulation === v} onChange={() => up("h", { insulation: v })} {...(v === "bonne" ? inv("insulation") : {})} /><span>{l}{h && <small>{h}</small>}</span></label>
                ))}
              </div>
              <ErrorText k="insulation" errors={errors} />
            </fieldset>
            <details className="small"><summary>Comment est fait le calcul ?</summary><p className="muted">Pour chaque pièce : surface × puissance par m² selon l&apos;isolation (80, 100 ou 120 W/m² par défaut) × facteur de hauteur, divisé par {config.unitPowerW} W, arrondi à l&apos;appareil supérieur, au moins un appareil par pièce. C&apos;est un repère indicatif, pas une étude thermique.</p></details>
          </>
        )}

        {step === 1 && cool && (
          <>
            <div className="row-3">
              <label className="field"><span className="label">Surface (m²)</span><input type="number" inputMode="decimal" min={1} value={d.c.surface} onChange={(e) => up("c", { surface: e.target.value })} {...inv("csurface")} /><ErrorText k="csurface" errors={errors} /></label>
              <label className="field"><span className="label">Pièces</span><input type="number" inputMode="numeric" min={1} value={d.c.rooms} onChange={(e) => up("c", { rooms: e.target.value })} {...inv("crooms")} /><ErrorText k="crooms" errors={errors} /></label>
              <label className="field"><span className="label">Hauteur (m) <span className="hint">facultatif</span></span><input type="number" inputMode="decimal" step="0.05" placeholder="2,50" value={d.c.height} onChange={(e) => up("c", { height: e.target.value })} {...inv("cheight")} /><ErrorText k="cheight" errors={errors} /></label>
            </div>
            <fieldset><legend>Exposition principale</legend><div className="options">
              {(["nord", "est", "ouest", "sud", "inconnue"] as const).map((v) => <label key={v} className="option cool"><input type="radio" name="expo" checked={d.c.exposure === v} onChange={() => up("c", { exposure: v })} {...(v === "nord" ? inv("exposure") : {})} /><span>{v === "inconnue" ? "Je ne sais pas" : v[0].toUpperCase() + v.slice(1)}</span></label>)}
            </div><ErrorText k="exposure" errors={errors} /></fieldset>
            <fieldset><legend>Isolation</legend><div className="options">
              {([["bonne", "Bonne"], ["moyenne", "Moyenne"], ["faible", "Faible / sous toiture"], ["inconnue", "Je ne sais pas"]] as const).map(([v, l]) => <label key={v} className="option cool"><input type="radio" name="cins" checked={d.c.insulation === v} onChange={() => up("c", { insulation: v })} {...(v === "bonne" ? inv("cinsulation") : {})} /><span>{l}</span></label>)}
            </div><ErrorText k="cinsulation" errors={errors} /></fieldset>
            <fieldset><legend>Évacuation de l&apos;air chaud (gaine)</legend><div className="options">
              {([["fenetre", "Par une fenêtre"], ["ouverture_murale", "Ouverture murale existante"], ["non", "Aucune possibilité"], ["inconnu", "Je ne sais pas"]] as const).map(([v, l]) => <label key={v} className="option cool"><input type="radio" name="exh" checked={d.c.exhaust === v} onChange={() => up("c", { exhaust: v })} {...(v === "fenetre" ? inv("exhaust") : {})} /><span>{l}</span></label>)}
            </div><ErrorText k="exhaust" errors={errors} /></fieldset>
            <fieldset><legend>Prise électrique disponible à proximité</legend><div className="options">
              {([["oui", "Oui"], ["non", "Non"], ["inconnu", "Je ne sais pas"]] as const).map(([v, l]) => <label key={v} className="option cool"><input type="radio" name="pow" checked={d.c.power === v} onChange={() => up("c", { power: v })} {...(v === "oui" ? inv("power") : {})} /><span>{l}</span></label>)}
            </div><ErrorText k="power" errors={errors} /></fieldset>
            <div className="row-2">
              <label className="field"><span className="label">Nombre de personnes habituellement présentes <span className="hint">facultatif</span></span><input type="number" inputMode="numeric" min={0} value={d.c.people} onChange={(e) => up("c", { people: e.target.value })} /></label>
              <label className="check" style={{ alignSelf: "center" }}><input type="checkbox" checked={d.c.noise} onChange={(e) => up("c", { noise: e.target.checked })} /><span>Le bruit est une contrainte (chambre, réunion, commerce…)</span></label>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <label className="field"><span className="label">Type de lieu</span>
              <select value={d.site.placeType} onChange={(e) => up("site", { placeType: e.target.value })} {...inv("placeType")}>
                <option value="">— Choisir —</option>
                {PLACE_TYPES.map((p) => <option key={p} value={p}>{PLACE_LABEL[p]}</option>)}
              </select><ErrorText k="placeType" errors={errors} /></label>
            {d.site.placeType === "erp_ecole" && <div className="notice warn" style={{ marginBottom: 14 }}><p>ERP / école : la demande est traitée séparément. Le devis et toute utilisation sont soumis à la validation préalable du responsable du site (admissibilité des appareils et implantation).</p></div>}
            <div className="row-2">
              <label className="field"><span className="label">Étage <span className="hint">facultatif</span></span><input type="text" value={d.site.floor} maxLength={40} onChange={(e) => up("site", { floor: e.target.value })} placeholder="ex. 3e, RDC" /></label>
              <label className="field"><span className="label">Ascenseur</span>
                <select value={d.site.elevator} onChange={(e) => up("site", { elevator: e.target.value as Draft["site"]["elevator"] })}><option value="">Je ne sais pas</option><option value="oui">Oui</option><option value="non">Non</option></select></label>
            </div>
            <label className="field"><span className="label">Stationnement / contraintes de livraison <span className="hint">facultatif</span></span><input type="text" maxLength={300} value={d.site.parking} onChange={(e) => up("site", { parking: e.target.value })} placeholder="Rue piétonne, livraison possible devant l'immeuble, cour…" /></label>
            <label className="check"><input type="checkbox" checked={d.site.multiSite} onChange={(e) => up("site", { multiSite: e.target.checked })} /><span>Il faut équiper <strong>plusieurs logements ou sites distincts</strong> (devis groupé)</span></label>
            {d.site.multiSite && (
              <div className="row-2">
                <label className="field"><span className="label">Nombre de logements / sites</span><input type="number" min={2} value={d.site.siteCount} onChange={(e) => up("site", { siteCount: e.target.value })} {...inv("siteCount")} /><ErrorText k="siteCount" errors={errors} /></label>
                <label className="field"><span className="label">Détail par logement <span className="hint">facultatif</span></span><textarea maxLength={2000} value={d.site.multiSiteDetails} onChange={(e) => up("site", { multiSiteDetails: e.target.value })} placeholder="Lot 12 : 45 m², 3 pièces ; Lot 14 : …" /></label>
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <div aria-live="polite">
            {estErr && <div className="notice danger"><p>{estErr}. Vous pouvez continuer : notre équipe établira l&apos;estimation.</p></div>}
            {!est && !estErr && <p>Calcul en cours…</p>}
            {est?.heating && !cool && (
              <>
                <div className="result-box">
                  <div className="small muted">Recommandation indicative</div>
                  <div className="result-big">{est.heating.recommendedUnits} appareil{est.heating.recommendedUnits > 1 ? "s" : ""} de {config.unitPowerW} W</div>
                  <div>Puissance totale recommandée : {(est.heating.totalPowerW / 1000).toLocaleString("fr-FR")} kW</div>
                  <details className="small" style={{ marginTop: 8 }}><summary>Détail du calcul</summary>
                    <ul>
                      {est.heating.perRoom.map((r, i) => <li key={i}>Pièce {i + 1} : {r.surfaceM2.toLocaleString("fr-FR")} m² → {r.units} appareil{r.units > 1 ? "s" : ""}</li>)}
                      <li>Base : {est.heating.wattsPerM2Used} W/m² (isolation {est.heating.insulationUsed}), facteur hauteur ×{est.heating.heightFactor.toLocaleString("fr-FR")}</li>
                    </ul>
                  </details>
                </div>
                {est.heating.warnings.length > 0 && <div className="notice warn" style={{ marginBottom: 14 }}><ul>{est.heating.warnings.map((w) => <li key={w}>{HEATING_WARNING_TEXT[w]}</li>)}</ul></div>}
                <fieldset>
                  <legend>Quantité souhaitée</legend>
                  <div className="stepper">
                    <button type="button" aria-label="Diminuer la quantité" disabled={quantity <= 1} onClick={() => up("h", { quantity: Math.max(1, quantity - 1) })}>−</button>
                    <output aria-live="polite" aria-label="Quantité souhaitée">{quantity}</output>
                    <button type="button" aria-label="Augmenter la quantité" disabled={quantity >= config.maxSelectableUnits} onClick={() => up("h", { quantity: Math.min(config.maxSelectableUnits, quantity + 1) })}>+</button>
                  </div>
                  {d.h.quantity != null && d.h.quantity !== est.heating.recommendedUnits && (
                    <button type="button" className="btn ghost small" style={{ marginLeft: 10 }} onClick={() => up("h", { quantity: null })}>Revenir à la recommandation</button>
                  )}
                  <p className="hint">Vous pouvez ajuster la quantité (y compris prévoir un appareil de réserve). Les deux valeurs — recommandée et souhaitée — sont transmises.</p>
                </fieldset>
                <div className="notice warn" role="note">
                  <p><strong>Sécurité électrique</strong></p>
                  <ul>
                    {est.quantityWarnings.map((w) => <li key={w}>{w}</li>)}
                    <li>Cette recommandation commerciale n&apos;est pas une autorisation électrique : la capacité du logement ou du bâtiment doit être confirmée par une personne compétente. La notice du constructeur prime ; aucune garantie de température.</li>
                    <li>Pas de multiprise ni de rallonge sauf autorisation expresse conforme à la notice.</li>
                  </ul>
                </div>
              </>
            )}
            {est?.cooling && cool && (
              <>
                <div className="result-box">
                  <div className="small muted">Fourchette indicative de puissance frigorifique</div>
                  <div className="result-big">{(est.cooling.lowW / 1000).toLocaleString("fr-FR")} à {(est.cooling.highW / 1000).toLocaleString("fr-FR")} kW froid</div>
                  <div>soit environ {est.cooling.lowBtu.toLocaleString("fr-FR")} à {est.cooling.highBtu.toLocaleString("fr-FR")} BTU/h</div>
                </div>
                <div className="notice info"><ul>{est.cooling.feasibilityNotes.map((n) => <li key={n}>{n}</li>)}</ul></div>
                <p className="small muted" style={{ marginTop: 12 }}>Tarifs : <strong>sur devis</strong>. Disponibilité : <strong>à confirmer</strong>. Le nombre et le type d&apos;appareils seront proposés par notre équipe.</p>
              </>
            )}
          </div>
        )}

        {step === 4 && (
          <>
            <div className="row-2">
              <label className="field"><span className="label">Date de début souhaitée</span><input type="date" min={todayInParis()} value={d.sched.start} onChange={(e) => up("sched", { start: e.target.value })} {...inv("start")} /><span className="hint">Souhait : la date de livraison réelle sera convenue avec vous.</span><ErrorText k="start" errors={errors} /></label>
              <label className="field"><span className="label">Durée estimée (jours)</span><input type="number" inputMode="numeric" min={1} max={365} disabled={d.sched.durationUnknown} value={d.sched.durationUnknown ? "" : d.sched.days} onChange={(e) => up("sched", { days: e.target.value })} {...inv("days")} /><ErrorText k="days" errors={errors} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={d.sched.durationUnknown} onChange={(e) => up("sched", { durationUnknown: e.target.checked })} /><span>Durée inconnue pour l&apos;instant (prix sur devis)</span></label>
            <div className="row-2">
              <label className="field"><span className="label">Reprise prévue <span className="hint">facultatif</span></span><input type="date" min={d.sched.start || todayInParis()} value={d.sched.returnDate} onChange={(e) => up("sched", { returnDate: e.target.value })} {...inv("returnDate")} /><ErrorText k="returnDate" errors={errors} /></label>
              <label className="field"><span className="label">Code postal du lieu de livraison</span><input type="text" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={d.deliv.postalCode} onChange={(e) => up("deliv", { postalCode: e.target.value.replace(/\D/g, "").slice(0, 5) })} {...inv("postalCode")} /><ErrorText k="postalCode" errors={errors} /></label>
            </div>
            {!cool && <label className="check"><input type="checkbox" checked={d.sched.express} onChange={(e) => up("sched", { express: e.target.checked })} /><span>Je souhaite une intervention express <span className="hint">Supplément uniquement si nous la confirmons ; aucun délai garanti.</span></span></label>}
            <PriceBox est={est} estErr={estErr} cool={cool} pro={pro} postalReady={/^\d{5}$/.test(d.deliv.postalCode)} />
          </>
        )}

        {step === 5 && (
          <>
            <h2 style={{ fontFamily: "var(--font)", fontSize: "1.1rem" }}>Le client / donneur d&apos;ordre</h2>
            <label className="field"><span className="label">Vous êtes</span>
              <select value={d.cust.kind} onChange={(e) => up("cust", { kind: e.target.value as Draft["cust"]["kind"], ...(e.target.value === "particulier" ? { siret: "" } : {}) })} {...inv("kind")}>
                <option value="">— Choisir —</option>
                {Object.entries(CLIENT_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select><ErrorText k="kind" errors={errors} /></label>
            {pro && (
              <div className="row-2">
                <label className="field"><span className="label">Raison sociale</span><input type="text" autoComplete="organization" maxLength={200} value={d.cust.companyName} onChange={(e) => up("cust", { companyName: e.target.value })} {...inv("companyName")} /><ErrorText k="companyName" errors={errors} /></label>
                <label className="field"><span className="label">SIRET <span className="hint">facultatif</span></span><input type="text" inputMode="numeric" maxLength={20} value={d.cust.siret} onChange={(e) => up("cust", { siret: e.target.value })} {...inv("siret")} /><ErrorText k="siret" errors={errors} /></label>
              </div>
            )}
            <div className="row-3">
              <label className="field"><span className="label">Nom du contact</span><input type="text" autoComplete="name" maxLength={120} value={d.cust.contactName} onChange={(e) => up("cust", { contactName: e.target.value })} {...inv("contactName")} /><ErrorText k="contactName" errors={errors} /></label>
              <label className="field"><span className="label">Téléphone</span><input type="tel" autoComplete="tel" maxLength={30} value={d.cust.phone} onChange={(e) => up("cust", { phone: e.target.value })} {...inv("phone")} /><ErrorText k="phone" errors={errors} /></label>
              <label className="field"><span className="label">Email</span><input type="email" autoComplete="email" maxLength={160} value={d.cust.email} onChange={(e) => up("cust", { email: e.target.value })} {...inv("email")} /><ErrorText k="email" errors={errors} /></label>
            </div>
            <label className="field"><span className="label">Votre référence interne / n° de commande <span className="hint">facultatif</span></span><input type="text" maxLength={80} value={d.cust.ref} onChange={(e) => up("cust", { ref: e.target.value })} /></label>
            <label className="check"><input type="checkbox" checked={d.cust.billing} onChange={(e) => up("cust", { billing: e.target.checked })} /><span>Indiquer une adresse de facturation / du client</span></label>
            {d.cust.billing && (
              <div className="row-3">
                <label className="field"><span className="label">Adresse</span><input type="text" maxLength={200} value={d.cust.b1} onChange={(e) => up("cust", { b1: e.target.value })} {...inv("b1")} /><ErrorText k="b1" errors={errors} /></label>
                <label className="field"><span className="label">Code postal</span><input type="text" inputMode="numeric" maxLength={5} value={d.cust.bpc} onChange={(e) => up("cust", { bpc: e.target.value.replace(/\D/g, "").slice(0, 5) })} {...inv("bpc")} /><ErrorText k="bpc" errors={errors} /></label>
                <label className="field"><span className="label">Commune</span><input type="text" maxLength={100} value={d.cust.bcity} onChange={(e) => up("cust", { bcity: e.target.value })} {...inv("bcity")} /><ErrorText k="bcity" errors={errors} /></label>
              </div>
            )}
            <h2 style={{ fontFamily: "var(--font)", fontSize: "1.1rem", marginTop: 22 }}>Le lieu de livraison et la personne qui réceptionne</h2>
            <p className="small muted">L&apos;adresse de livraison peut être différente de la vôtre, et la personne présente sur place peut être quelqu&apos;un d&apos;autre (occupant, locataire, gardien…).</p>
            <label className="check"><input type="checkbox" checked={d.deliv.sameAsContact} onChange={(e) => up("deliv", { sameAsContact: e.target.checked })} /><span>C&apos;est moi qui réceptionnerai le matériel</span></label>
            {!d.deliv.sameAsContact && (
              <div className="row-2">
                <label className="field"><span className="label">Nom du réceptionnaire</span><input type="text" maxLength={120} value={d.deliv.recipientName} onChange={(e) => up("deliv", { recipientName: e.target.value })} {...inv("recipientName")} /><ErrorText k="recipientName" errors={errors} /></label>
                <label className="field"><span className="label">Téléphone du réceptionnaire</span><input type="tel" maxLength={30} value={d.deliv.recipientPhone} onChange={(e) => up("deliv", { recipientPhone: e.target.value })} {...inv("recipientPhone")} /><ErrorText k="recipientPhone" errors={errors} /></label>
              </div>
            )}
            <label className="field"><span className="label">Numéro et rue</span><input type="text" autoComplete="address-line1" maxLength={200} value={d.deliv.line1} onChange={(e) => up("deliv", { line1: e.target.value })} {...inv("line1")} /><ErrorText k="line1" errors={errors} /></label>
            <div className="row-3">
              <label className="field"><span className="label">Bâtiment, escalier… <span className="hint">facultatif</span></span><input type="text" autoComplete="address-line2" maxLength={200} value={d.deliv.line2} onChange={(e) => up("deliv", { line2: e.target.value })} /></label>
              <label className="field"><span className="label">Code postal</span><input type="text" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={d.deliv.postalCode} onChange={(e) => up("deliv", { postalCode: e.target.value.replace(/\D/g, "").slice(0, 5) })} {...inv("dpostalCode")} /><ErrorText k="dpostalCode" errors={errors} /></label>
              <label className="field"><span className="label">Commune</span><input type="text" autoComplete="address-level2" maxLength={100} value={d.deliv.city} onChange={(e) => up("deliv", { city: e.target.value })} {...inv("city")} /><ErrorText k="city" errors={errors} /></label>
            </div>
            <div className="row-2">
              <label className="field"><span className="label">Instructions d&apos;accès <span className="hint">facultatif</span></span><textarea maxLength={1000} value={d.deliv.access} onChange={(e) => up("deliv", { access: e.target.value })} placeholder="Interphone, digicode, gardien…" /></label>
              <label className="field"><span className="label">Horaires souhaités <span className="hint">facultatif</span></span><textarea maxLength={300} value={d.deliv.hours} onChange={(e) => up("deliv", { hours: e.target.value })} placeholder="ex. matin en semaine" /></label>
            </div>
          </>
        )}

        {step === 6 && (
          <>
            <table className="summary-table">
              <tbody>
                <tr><th scope="row">Service</th><td>{cool ? "Climatisation mobile (sur devis)" : "Chauffage d'appoint — radiateurs à bain d'huile"}</td></tr>
                {!cool && <tr><th scope="row">Matériel et quantité</th><td>{quantity} appareil{quantity > 1 ? "s" : ""} de {config.unitPowerW} W ({(quantity * config.unitPowerW / 1000).toLocaleString("fr-FR")} kW au total){est?.heating ? ` — recommandation indicative : ${est.heating.recommendedUnits}` : ""}</td></tr>}
                {cool && est?.cooling && <tr><th scope="row">Puissance indicative</th><td>{(est.cooling.lowW / 1000).toLocaleString("fr-FR")} à {(est.cooling.highW / 1000).toLocaleString("fr-FR")} kW froid (à valider)</td></tr>}
                <tr><th scope="row">Lieu</th><td>{PLACE_LABEL[d.site.placeType as keyof typeof PLACE_LABEL]}{d.site.multiSite ? ` — ${d.site.siteCount} logements/sites (devis groupé)` : ""}</td></tr>
                <tr><th scope="row">Dates souhaitées</th><td>Début : {formatIsoDate(d.sched.start)} · {d.sched.durationUnknown ? "durée inconnue" : `${d.sched.days} jour(s) estimé(s)`}{d.sched.returnDate ? ` · reprise prévue : ${formatIsoDate(d.sched.returnDate)}` : ""}</td></tr>
                <tr><th scope="row">Logistique</th><td>Livraison et reprise (aller + retour) au lieu indiqué, créneau à confirmer{d.sched.express ? " · express demandé (si confirmé)" : ""}</td></tr>
                <tr><th scope="row">Donneur d&apos;ordre</th><td>{pro && d.cust.companyName ? `${d.cust.companyName} — ` : ""}{d.cust.contactName} · {d.cust.phone} · {d.cust.email}{pro && d.cust.siret ? ` · SIRET ${d.cust.siret}` : ""}{d.cust.ref ? ` · Réf. ${d.cust.ref}` : ""}</td></tr>
                <tr><th scope="row">Réceptionnaire</th><td>{d.deliv.sameAsContact ? `${d.cust.contactName} · ${d.cust.phone}` : `${d.deliv.recipientName} · ${d.deliv.recipientPhone}`}</td></tr>
                <tr><th scope="row">Adresse de livraison</th><td>{d.deliv.line1}{d.deliv.line2 ? `, ${d.deliv.line2}` : ""}, {d.deliv.postalCode} {d.deliv.city}{d.site.floor ? ` · étage ${d.site.floor}` : ""}{d.site.elevator ? ` · ascenseur : ${d.site.elevator}` : ""}</td></tr>
              </tbody>
            </table>
            <div style={{ marginTop: 16 }}><PriceBox est={est} estErr={estErr} cool={cool} pro={pro} postalReady /></div>
            <label className="field" style={{ marginTop: 16 }}><span className="label">Informations complémentaires <span className="hint">facultatif</span></span><textarea maxLength={2000} value={d.notes} onChange={(e) => up("notes", e.target.value)} placeholder="Contexte de la panne, contraintes particulières…" /></label>
            <div className="hp" aria-hidden="true"><label>Ne pas remplir<input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label></div>
            <label className="check"><input type="checkbox" checked={d.terms} onChange={(e) => up("terms", e.target.checked)} {...inv("terms")} /><span>J&apos;ai compris qu&apos;il s&apos;agit d&apos;une <strong>demande sans paiement, sous réserve de confirmation</strong> du stock, du prix et du créneau, et j&apos;accepte les <Link href="/conditions" target="_blank">conditions de la demande</Link>.</span></label>
            <label className="check"><input type="checkbox" checked={d.privacy} onChange={(e) => up("privacy", e.target.checked)} {...inv("privacy")} /><span>J&apos;ai pris connaissance de la <Link href="/confidentialite" target="_blank">politique de confidentialité</Link> : mes coordonnées et celles du réceptionnaire sont utilisées uniquement pour traiter cette demande.</span></label>
            {config.turnstileSiteKey && <div ref={turnstileRef} style={{ margin: "10px 0" }} />}
            <ErrorText k="turnstile" errors={errors} />
            {submitError && <div className="notice danger" role="alert" style={{ marginTop: 12 }}><p><strong>Demande non envoyée.</strong> {submitError}</p></div>}
          </>
        )}

        <div className="nav-buttons">
          {step > 0 ? <button type="button" className="btn secondary" onClick={() => go(step - 1)} disabled={submitting}>← Retour</button> : <span />}
          {step < 6 ? (
            <button type="submit" className={`btn ${cool ? "frost" : ""}`}>{step === 5 ? "Vérifier ma demande" : "Continuer →"}</button>
          ) : (
            <button type="submit" className={`btn ${cool ? "frost" : ""}`} disabled={submitting} aria-busy={submitting}>{submitting ? "Envoi en cours…" : "Envoyer ma demande"}</button>
          )}
        </div>
        <p className="tiny muted" style={{ marginTop: 12 }}>Demande de précommande / estimation sans paiement. Sous réserve de confirmation. Aucune donnée n&apos;est envoyée avant « Envoyer ma demande » ; votre saisie est conservée sur cet appareil en attendant.</p>
      </form>
    </div>
  );
}

function ErrorText({ k, errors }: { k: string; errors: Errors }) {
  return errors[k] ? <div className="error-text" id={`err-${k}`}>{errors[k]}</div> : null;
}

function PriceBox({ est, estErr, cool, pro, postalReady }: { est: EstimateResponse | null; estErr: string | null; cool: boolean; pro: boolean; postalReady: boolean }) {
  if (cool) return <div className="result-box"><strong>Prix : sur devis.</strong> <span className="small">Aucune grille climatisation n&apos;est encore validée : nous vous adresserons une proposition.</span></div>;
  if (estErr) return <div className="notice warn"><p>Estimation de prix momentanément indisponible ; vous pouvez tout de même envoyer votre demande.</p></div>;
  if (!est || !postalReady) return <div className="result-box small">Indiquez le code postal et la durée pour afficher l&apos;estimation.</div>;
  const p = est.price;
  if (p.mode === "sur_devis") {
    return (
      <div className="result-box" aria-live="polite">
        <div className="result-big" style={{ fontSize: "1.5rem" }}>Prix : sur devis</div>
        <ul className="small">{p.reasons.map((r) => <li key={r}>{QUOTE_REASON_TEXT[r]}</li>)}</ul>
        <p className="tiny muted" style={{ margin: 0 }}>Vos paramètres (surface, quantité, dates) sont conservés dans la demande pour établir le devis.</p>
      </div>
    );
  }
  return (
    <div className="result-box" aria-live="polite">
      <div className="small muted">Prix estimatif — calculé par notre serveur avec la grille en vigueur</div>
      <table className="summary-table price-lines">
        <tbody>
          {p.lines.map((l) => <tr key={l.code}><td>{l.label}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</td><td>{formatEuros(l.totalHtCents)} HT</td></tr>)}
          <tr className="total-line"><td>Total estimé HT</td><td>{formatEuros(p.totalHtCents)}</td></tr>
          {est.vatApplicable && <tr className={pro ? "" : "total-line"}><td>{pro ? "Total TTC indicatif" : "Total estimé TTC"} (TVA {p.vatRateBp / 100} %)</td><td>{formatEuros(p.totalTtcCents)}</td></tr>}
        </tbody>
      </table>
      {p.expressOptionHtCents != null && <p className="small" style={{ margin: "8px 0 0" }}>Option express demandée : +{formatEuros(p.expressOptionHtCents)} HT <strong>uniquement si confirmée</strong> (non incluse ci-dessus).</p>}
      <ul className="tiny muted" style={{ marginBottom: 0 }}>{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </div>
  );
}
