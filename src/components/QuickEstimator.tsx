"use client";
import { useEffect, useMemo, useState } from "react";
import { estimateHeating, HEATING_WARNING_TEXT } from "@/lib/domain/heating";
import type { BusinessSettings } from "@/lib/domain/settings";
import { track } from "./Track";

/** Mini-simulateur immédiat (quantité indicative). Le prix est calculé par le serveur dans l'assistant. */
export default function QuickEstimator({ settings }: { settings: BusinessSettings }) {
  const [surface, setSurface] = useState("25");
  const [rooms, setRooms] = useState("1");
  const [insulation, setInsulation] = useState<"bonne" | "moyenne" | "faible" | "inconnue">("moyenne");
  const [started, setStarted] = useState(false);

  const est = useMemo(() => {
    const s = Number(surface.replace(",", "."));
    const r = Math.floor(Number(rooms));
    if (!(s >= 1 && s <= 5000) || !(r >= 1 && r <= 100)) return null;
    try {
      return estimateHeating({ totalSurfaceM2: s, rooms: r, ceilingHeightM: 2.5, insulation, placeType: "appartement" }, settings);
    } catch {
      return null;
    }
  }, [surface, rooms, insulation, settings]);

  useEffect(() => {
    if (started) track("start_estimator", "chauffage");
  }, [started]);

  const href = `/demande?service=chauffage&surface=${encodeURIComponent(surface)}&pieces=${encodeURIComponent(rooms)}&isolation=${insulation}`;
  return (
    <div className="panel" onFocusCapture={() => setStarted(true)}>
      <h3 style={{ marginTop: 0 }}>Quelle surface souhaitez-vous chauffer ?</h3>
      <div className="row-3">
        <label className="field">
          <span className="label">Surface totale (m²)</span>
          <input type="number" inputMode="decimal" min={1} max={5000} value={surface} onChange={(e) => setSurface(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Pièces à chauffer</span>
          <input type="number" inputMode="numeric" min={1} max={100} value={rooms} onChange={(e) => setRooms(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Isolation</span>
          <select value={insulation} onChange={(e) => setInsulation(e.target.value as typeof insulation)}>
            <option value="bonne">Bonne</option>
            <option value="moyenne">Moyenne</option>
            <option value="faible">Faible / ancienne</option>
            <option value="inconnue">Je ne sais pas</option>
          </select>
        </label>
      </div>
      <div className="result-box" aria-live="polite">
        {est ? (
          <>
            <div className="small muted">Recommandation indicative (hauteur standard 2,50 m)</div>
            <div className="result-big">{est.recommendedUnits} radiateur{est.recommendedUnits > 1 ? "s" : ""} de {settings.heating.sizing.unitPowerW} W</div>
            <div className="small">Puissance totale : {(est.totalPowerW / 1000).toLocaleString("fr-FR")} kW — base {est.wattsPerM2Used} W/m², calcul pièce par pièce.</div>
            {est.warnings.filter((w) => w !== "surface_repartie").map((w) => <p key={w} className="tiny" style={{ margin: "6px 0 0" }}>⚠ {HEATING_WARNING_TEXT[w]}</p>)}
          </>
        ) : (
          <div className="small">Indiquez une surface et un nombre de pièces valides.</div>
        )}
      </div>
      <a className="btn" href={href}>Continuer : dates, adresse et prix</a>
      <p className="tiny muted" style={{ marginTop: 10 }}>Estimation indicative : elle ne remplace ni une étude thermique, ni une vérification de l&apos;installation électrique.</p>
    </div>
  );
}
