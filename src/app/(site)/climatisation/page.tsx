import type { Metadata } from "next";
import Link from "next/link";
import Faq from "@/components/Faq";
import Track from "@/components/Track";

export const metadata: Metadata = {
  title: "Location de climatiseur mobile à Lyon — sur devis",
  description:
    "Climatisation mobile temporaire à Lyon : décrivez votre pièce (surface, exposition, évacuation d'air chaud), recevez une estimation indicative de puissance et un devis. Disponibilité à confirmer.",
  alternates: { canonical: "/climatisation" },
};

export default function Climatisation() {
  return (
    <>
      <Track event="view_service" service="climatisation" />
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <p className="eyebrow frost">Climatisation mobile temporaire</p>
            <h1>Un local trop chaud ? Préparons votre climatisation temporaire.</h1>
            <p className="lead">
              Nous préparons une offre de climatiseurs mobiles livrés et repris à Lyon. Dès aujourd&apos;hui, décrivez votre besoin :
              vous obtenez une <strong>estimation indicative de puissance frigorifique</strong> et nous revenons vers vous avec un devis.
            </p>
            <div className="btn-row">
              <Link className="btn frost" href="/demande?service=climatisation">Décrire mon besoin</Link>
            </div>
          </div>
          <div className="card" style={{ borderColor: "var(--frost)" }}>
            <h2 style={{ fontSize: "1.3rem" }}>Ce qu&apos;il faut savoir</h2>
            <ul>
              <li><strong>Tarifs : sur devis</strong>, aucune grille n&apos;est encore publiée.</li>
              <li><strong>Disponibilité : à confirmer</strong> selon les appareils et la période.</li>
              <li>Un climatiseur mobile doit <strong>évacuer l&apos;air chaud</strong> vers l&apos;extérieur (fenêtre, ouverture) : c&apos;est le premier point vérifié.</li>
              <li>Sans paiement, sans engagement : notre équipe vous recontacte.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Les informations qui comptent pour bien dimensionner</h2>
          <div className="grid-3" style={{ marginTop: 20 }}>
            <div className="card"><h3>Surface et hauteur</h3><p>La puissance dépend du volume à rafraîchir, pièce par pièce.</p></div>
            <div className="card"><h3>Exposition et isolation</h3><p>Une pièce plein sud sous toiture n&apos;a pas le même besoin qu&apos;un bureau au nord.</p></div>
            <div className="card"><h3>Occupants et équipements</h3><p>Chaque personne et chaque appareil ajoutent de la chaleur.</p></div>
            <div className="card"><h3>Évacuation d&apos;air chaud</h3><p>Fenêtre ou ouverture pour la gaine : sans elle, une autre solution doit être étudiée.</p></div>
            <div className="card"><h3>Bruit</h3><p>Chambre, salle de réunion, commerce : signalez-nous les contraintes sonores.</p></div>
            <div className="card"><h3>Alimentation</h3><p>Prise à proximité et capacité du circuit à vérifier par une personne compétente.</p></div>
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="narrow">
          <h2>Questions sur la climatisation mobile</h2>
          <Faq
            items={[
              { q: "Pouvez-vous me donner un prix tout de suite ?", a: "Pas encore : tant que les gammes, capacités et tarifs ne sont pas validés, nous établissons un devis personnalisé. Nous ne publions pas de prix que nous ne pourrions pas tenir." },
              { q: "L'estimation de puissance est-elle fiable ?", a: "C'est une fourchette indicative (en watts froid et BTU/h) calculée à partir de vos réponses. Elle sera validée par notre équipe ; elle ne constitue ni une étude thermique ni une garantie de température." },
              { q: "Les demandes chauffage et climatisation suivent-elles le même parcours ?", a: "Oui : demande enregistrée, confirmation humaine, bon de remise et de reprise signé sur place." },
            ]}
          />
          <div className="btn-row" style={{ marginTop: 24 }}><Link className="btn frost" href="/demande?service=climatisation">Décrire mon besoin</Link></div>
        </div>
      </section>
    </>
  );
}
