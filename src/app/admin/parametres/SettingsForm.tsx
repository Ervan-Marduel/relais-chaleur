"use client";
import { useActionState, useState } from "react";
import type { BusinessSettings } from "@/lib/domain/settings";
import { settingsAction } from "../actions";

/** Édition guidée des principaux paramètres + JSON complet (validé côté serveur par Zod). */
export default function SettingsForm({ initial }: { initial: BusinessSettings }) {
  const [s, setS] = useState<BusinessSettings>(initial);
  const [state, action, pending] = useActionState(settingsAction, null as null | { ok?: string; error?: string });
  const [raw, setRaw] = useState<string | null>(null);
  const json = raw ?? JSON.stringify(s, null, 2);
  const upd = (f: (x: BusinessSettings) => void) => { const c = structuredClone(s); f(c); setS(c); setRaw(null); };
  const n = (v: string) => (v === "" ? 0 : Math.round(Number(v)));
  const zone = s.zones[0];
  return (
    <form action={action} className="box">
      {state?.ok && <div className="notice ok flash"><p>{state.ok}</p></div>}
      {state?.error && <div className="notice danger flash" role="alert"><p>{state.error}</p></div>}
      <h2>Location chauffage (HT, par appareil)</h2>
      {s.heating.rentalTiers.map((t, i) => (
        <div className="inline-form" key={i} style={{ marginBottom: 6 }}>
          <label className="field"><span className="label small">De (j)</span><input type="number" value={t.minDays} onChange={(e) => upd((c) => { c.heating.rentalTiers[i].minDays = n(e.target.value); })} /></label>
          <label className="field"><span className="label small">À (j)</span><input type="number" value={t.maxDays} onChange={(e) => upd((c) => { c.heating.rentalTiers[i].maxDays = n(e.target.value); })} /></label>
          <label className="field"><span className="label small">Prix HT (centimes)</span><input type="number" value={t.unitPriceHtCents} onChange={(e) => upd((c) => { c.heating.rentalTiers[i].unitPriceHtCents = n(e.target.value); })} /></label>
        </div>
      ))}
      <h2 style={{ marginTop: 14 }}>Livraison + reprise — {zone.label}</h2>
      {zone.logistics.map((l, i) => (
        <div className="inline-form" key={i} style={{ marginBottom: 6 }}>
          <label className="field"><span className="label small">De (app.)</span><input type="number" value={l.minUnits} onChange={(e) => upd((c) => { c.zones[0].logistics[i].minUnits = n(e.target.value); })} /></label>
          <label className="field"><span className="label small">À (app.)</span><input type="number" value={l.maxUnits} onChange={(e) => upd((c) => { c.zones[0].logistics[i].maxUnits = n(e.target.value); })} /></label>
          <label className="field"><span className="label small">Prix HT (centimes)</span><input type="number" value={l.priceHtCents} onChange={(e) => upd((c) => { c.zones[0].logistics[i].priceHtCents = n(e.target.value); })} /></label>
        </div>
      ))}
      <label className="field"><span className="label small">Codes postaux de la zone (séparés par des virgules)</span>
        <input type="text" value={zone.postalCodes.join(", ")} onChange={(e) => upd((c) => { c.zones[0].postalCodes = e.target.value.split(/[,\s]+/).filter(Boolean); })} /></label>
      <div className="row-3">
        <label className="field"><span className="label small">Express HT (centimes)</span><input type="number" value={s.heating.expressSurchargeHtCents} onChange={(e) => upd((c) => { c.heating.expressSurchargeHtCents = n(e.target.value); })} /></label>
        <label className="field"><span className="label small">TVA (points de base)</span><input type="number" value={s.vatRateBp} onChange={(e) => upd((c) => { c.vatRateBp = n(e.target.value); })} /></label>
        <label className="check small" style={{ alignSelf: "end" }}><input type="checkbox" checked={s.vatApplicable} onChange={(e) => upd((c) => { c.vatApplicable = e.target.checked; })} /><span>TVA applicable</span></label>
      </div>
      <h2 style={{ marginTop: 14 }}>Règle de puissance chauffage (W/m²)</h2>
      <div className="row-3">
        {(["bonne", "moyenne", "faible"] as const).map((k) => (
          <label className="field" key={k}><span className="label small">Isolation {k}</span><input type="number" value={s.heating.sizing.wattsPerM2[k]} onChange={(e) => upd((c) => { c.heating.sizing.wattsPerM2[k] = n(e.target.value); })} /></label>
        ))}
      </div>
      <div className="row-3">
        <label className="field"><span className="label small">Hauteur max. avant devis (m)</span><input type="number" step="0.1" value={s.heating.sizing.maxHeightM} onChange={(e) => upd((c) => { c.heating.sizing.maxHeightM = Number(e.target.value); })} /></label>
        <label className="field"><span className="label small">Max. appareils / logement sans revue</span><input type="number" value={s.heating.sizing.maxUnitsPerDwellingAuto} onChange={(e) => upd((c) => { c.heating.sizing.maxUnitsPerDwellingAuto = n(e.target.value); })} /></label>
        <label className="check small" style={{ alignSelf: "end" }}><input type="checkbox" checked={s.cooling.pricingEnabled} onChange={(e) => upd((c) => { c.cooling.pricingEnabled = e.target.checked; })} disabled /><span>Tarifs clim (phase 2)</span></label>
      </div>
      <h2 style={{ marginTop: 14 }}>Décompte des jours facturables</h2>
      <label className="field"><span className="label small">Règle — à définir UNIQUEMENT après validation juridique des CGL</span>
        <select value={s.rental?.dayCountRule ?? ""} onChange={(e) => upd((c) => { c.rental = { dayCountRule: (e.target.value || null) as BusinessSettings["rental"]["dayCountRule"] }; })}>
          <option value="">Non définie (durée « à déterminer »)</option>
          <option value="calendar_inclusive">Jours calendaires, remise et reprise incluses</option>
          <option value="started_24h_periods">Périodes de 24 h entamées</option>
        </select></label>
      <p className="tiny muted">S&apos;applique aux demandes créées avec cette version (conditions acceptées). Les demandes antérieures gardent leur règle.</p>
      <details style={{ marginTop: 10 }}>
        <summary className="small"><strong>Tous les paramètres (JSON avancé)</strong></summary>
        <textarea style={{ fontFamily: "monospace", fontSize: 12, minHeight: 300, marginTop: 8 }} value={json} onChange={(e) => setRaw(e.target.value)} aria-label="Paramètres JSON" />
      </details>
      <input type="hidden" name="payload" value={json} />
      <label className="field" style={{ marginTop: 10 }}><span className="label small">Motif de la modification (tracé)</span><input type="text" name="note" required /></label>
      <button className="btn" disabled={pending}>{pending ? "Publication…" : "Publier une nouvelle version"}</button>
    </form>
  );
}
