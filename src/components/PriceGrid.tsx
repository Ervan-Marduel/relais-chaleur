import Link from "next/link";
import type { BusinessSettings } from "@/lib/domain/settings";
import { formatEuros } from "@/lib/format";

export default function PriceGrid({ settings }: { settings: BusinessSettings | null }) {
  if (!settings) {
    return (
      <div className="notice warn">
        <p>Les tarifs ne peuvent pas être affichés pour le moment. Le simulateur vous donnera une estimation dès que le service sera disponible.</p>
      </div>
    );
  }
  const vat = settings.vatApplicable ? 1 + settings.vatRateBp / 10000 : 1;
  const zone = settings.zones[0];
  return (
    <div>
      <div className="grid-4">
        {settings.heating.rentalTiers.map((t) => (
          <div className="price-card" key={t.minDays}>
            <span className="tag">{t.minDays} à {t.maxDays} jours</span>
            <span className="amount">{formatEuros(t.unitPriceHtCents)} <small className="small">HT</small></span>
            <span className="small muted">par appareil · {formatEuros(Math.round(t.unitPriceHtCents * vat))} TTC{settings.vatApplicable ? "*" : ""}</span>
          </div>
        ))}
      </div>
      <div className="card soft" style={{ marginTop: 14 }}>
        <h3>Livraison ET reprise (aller + retour)</h3>
        <ul>
          {zone.logistics.map((l) => (
            <li key={l.minUnits}>
              {zone.label} — {l.minUnits} à {l.maxUnits} appareils : <strong>{formatEuros(l.priceHtCents)} HT</strong> ({formatEuros(Math.round(l.priceHtCents * vat))} TTC{settings.vatApplicable ? "*" : ""}) par commande
            </li>
          ))}
          <li>Au-delà de {Math.max(...zone.logistics.map((l) => l.maxUnits))} appareils, autres communes, durée inconnue ou supérieure à {Math.max(...settings.heating.rentalTiers.map((t) => t.maxDays))} jours : <strong>sur devis</strong>.</li>
          <li>Intervention express : +{formatEuros(settings.heating.expressSurchargeHtCents)} HT, <strong>uniquement si nous la confirmons</strong> (jamais garantie).</li>
        </ul>
        <p className="tiny muted">
          Tarifs indicatifs de la grille en vigueur, hors électricité (consommation à la charge de l&apos;utilisateur). {settings.vatApplicable ? `* ${settings.vatNote}` : "TVA non applicable selon le statut du loueur (à confirmer)."} Prix confirmé après vérification du stock, de la zone, de la capacité électrique et du créneau.
        </p>
        <Link className="btn" href="/demande?service=chauffage">Estimer mon besoin</Link>
      </div>
    </div>
  );
}
