import type { Metadata } from "next";
import Link from "next/link";
import PriceGrid from "@/components/PriceGrid";
import QuickEstimator from "@/components/QuickEstimator";
import SafetyNotice from "@/components/SafetyNotice";
import Faq from "@/components/Faq";
import Track from "@/components/Track";
import { getPublicSettings } from "@/server/public-settings";
import { estimatePrice } from "@/lib/domain/pricing";
import { formatEuros } from "@/lib/format";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Location de radiateur à bain d'huile à Lyon — livré et repris",
  description:
    "Location temporaire de radiateurs électriques à bain d'huile à Lyon et Villeurbanne : panne de chaudière, copropriété, logement, commerce, chantier. Livraison et reprise, estimation en ligne sans paiement.",
  alternates: { canonical: "/chauffage" },
};

export default async function Chauffage() {
  const pub = await getPublicSettings();
  const s = pub?.settings ?? null;
  const ex = s && s.zones[0] ? estimatePrice({ service: "chauffage", quantity: 5, estimatedDays: 14, postalCode: s.zones[0].postalCodes[0], expressRequested: false, multiSite: false }, s) : null;
  return (
    <>
      <Track event="view_service" service="chauffage" />
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <p className="eyebrow">Chauffage d&apos;appoint temporaire</p>
            <h1>Location de radiateurs à bain d&apos;huile, livrés et repris à Lyon.</h1>
            <p className="lead">
              Des radiateurs électriques mobiles de 2 000 W pour passer une panne de chaudière, chauffer un logement en attente de
              réparation, un commerce ou un local de chantier. Nous livrons, puis nous reprenons le matériel en fin de location.
            </p>
            <div className="btn-row">
              <Link className="btn" href="/demande?service=chauffage">Estimer mon besoin</Link>
              <a className="btn secondary" href="#tarifs">Voir les tarifs</a>
            </div>
          </div>
          {s ? <QuickEstimator settings={s} /> : <div className="notice warn">Simulateur momentanément indisponible. <Link href="/demande?service=chauffage">Ouvrir l&apos;assistant</Link>.</div>}
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Pour quelles situations ?</h2>
          <div className="grid-3" style={{ marginTop: 20 }}>
            <div className="card"><h3>Panne de chaudière</h3><p>Un chauffage d&apos;appoint le temps du diagnostic, de la pièce détachée ou du remplacement.</p></div>
            <div className="card"><h3>Copropriétés et syndics</h3><p>Panne collective : plusieurs logements équipés, réceptionnaires différents, un seul interlocuteur.</p></div>
            <div className="card"><h3>Bailleurs et logements</h3><p>Le propriétaire commande, le locataire réceptionne : les deux identités restent distinctes.</p></div>
            <div className="card"><h3>Commerces et bureaux</h3><p>Maintenir une activité ouverte au public ou un poste de travail pendant une intervention.</p></div>
            <div className="card"><h3>Chauffagistes</h3><p>Proposer une solution d&apos;attente à vos clients sans immobiliser votre propre stock.</p></div>
            <div className="card"><h3>Écoles et ERP</h3><p>Traitement séparé : devis soumis à la validation préalable du responsable du site avant toute utilisation.</p></div>
          </div>
        </div>
      </section>

      <section className="section alt" id="calcul">
        <div className="narrow">
          <h2>Comment est calculée la recommandation ?</h2>
          <p>Nous partons de la <strong>surface de chaque pièce</strong> à chauffer, car un radiateur ne chauffe pas uniformément deux pièces fermées. Repère de départ, à hauteur sous plafond standard (2,50 m) :</p>
          <ul>
            <li>bonne isolation : {s?.heating.sizing.wattsPerM2.bonne ?? 80} W/m², soit environ 25 m² par radiateur de 2 000 W ;</li>
            <li>isolation moyenne : {s?.heating.sizing.wattsPerM2.moyenne ?? 100} W/m², environ 20 m² ;</li>
            <li>isolation faible ou ancienne : {s?.heating.sizing.wattsPerM2.faible ?? 120} W/m², environ 16 à 17 m².</li>
          </ul>
          <p>Au-delà de 2,50 m de hauteur, le besoin est augmenté proportionnellement au volume ; une hauteur atypique bascule en étude. Chaque pièce occupée reçoit au moins un appareil. Vous pouvez ensuite corriger la quantité.</p>
          <p className="small muted">C&apos;est une estimation : elle ne remplace ni une étude thermique, ni la vérification de l&apos;installation électrique, et aucune température n&apos;est garantie.</p>
          <SafetyNotice unitPowerW={s?.heating.sizing.unitPowerW} voltage={s?.heating.sizing.nominalVoltage} />
        </div>
      </section>

      <section className="section" id="tarifs">
        <div className="wrap">
          <p className="eyebrow">Tarifs indicatifs</p>
          <h2>Location par appareil + livraison et reprise.</h2>
          {ex && ex.mode === "estimate" && (
            <p className="muted">Exemple avec la grille en vigueur : 5 radiateurs pendant 14 jours ({s!.zones[0].label}) = {ex.lines.map((l) => (l.quantity > 1 ? `${l.quantity} × ${formatEuros(l.unitHtCents)}` : formatEuros(l.totalHtCents))).join(" + ")} = <strong>{formatEuros(ex.totalHtCents)} HT</strong>{ex.vatCents > 0 ? ` (${formatEuros(ex.totalTtcCents)} TTC)` : ""}.</p>
          )}
          <PriceGrid settings={s} />
        </div>
      </section>

      <section className="section alt">
        <div className="narrow">
          <h2>Questions sur la location de radiateurs</h2>
          <Faq
            items={[
              { q: "Quel radiateur est livré ?", a: "Des radiateurs électriques à bain d'huile de 2 000 W. La marque et le modèle exacts sont précisés à la confirmation et sur le bon de remise, avec la notice du fabricant." },
              { q: "Puis-je brancher plusieurs radiateurs sur la même prise ?", a: "Non. Pas de multiprise ni de rallonge sauf autorisation expresse conforme à la notice. Plusieurs prises d'une même pièce peuvent aussi partager un circuit : faites vérifier la capacité électrique par une personne compétente." },
              { q: "Comment est comptée la durée ?", a: "Vous indiquez une durée estimée pour l'estimation. La durée facturée est déterminée selon les dates réelles de mise à disposition et de reprise et les conditions de location convenues avec vous." },
              { q: "Et si je ne connais pas la durée ?", a: "Cochez « durée inconnue » : la demande est enregistrée et le prix est établi sur devis." },
            ]}
          />
          <div className="btn-row" style={{ marginTop: 24 }}><Link className="btn" href="/demande?service=chauffage">Estimer mon besoin / Envoyer ma demande</Link></div>
        </div>
      </section>
    </>
  );
}
