import type { Metadata } from "next";
import Link from "next/link";
import Track from "@/components/Track";

export const metadata: Metadata = {
  title: "Chauffage temporaire pour copropriétés, syndics et professionnels à Lyon",
  description:
    "Syndics, bailleurs, gestionnaires de biens, chauffagistes : chauffage temporaire multi-logements à Lyon, interlocuteur unique, bons de remise par logement, facturation hors site.",
  alternates: { canonical: "/professionnels" },
};

export default function Professionnels() {
  return (
    <>
      <Track event="view_service" service="chauffage" />
      <section className="hero">
        <div className="wrap">
          <p className="eyebrow">Syndics · bailleurs · gestionnaires · chauffagistes</p>
          <h1>Une panne collective, un seul interlocuteur.</h1>
          <p className="lead">
            Quand une chaufferie tombe en panne ou qu&apos;un chantier se prolonge, nous équipons plusieurs logements en une demande,
            avec un réceptionnaire par logement si besoin et un suivi centralisé pour le donneur d&apos;ordre.
          </p>
          <div className="btn-row">
            <Link className="btn" href="/demande?service=chauffage&multi=1">Demander une offre pour plusieurs logements</Link>
            <Link className="btn secondary" href="/demande?service=chauffage">Un seul site</Link>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="wrap grid-2">
          <div className="card">
            <h2 style={{ fontSize: "1.4rem" }}>Ce que nous prenons en charge</h2>
            <ul>
              <li>Demande groupée multi-logements, conservant les surfaces et quantités par logement</li>
              <li>Donneur d&apos;ordre distinct des réceptionnaires (locataires, gardien, occupant)</li>
              <li>Votre référence interne (ordre de service, n° de commande) reprise sur nos documents</li>
              <li>Bon de remise et de reprise signé sur place, avec références d&apos;inventaire des appareils</li>
              <li>Facturation hors site, selon les conditions convenues</li>
            </ul>
          </div>
          <div className="card soft">
            <h2 style={{ fontSize: "1.4rem" }}>Ce que nous vérifions avant de confirmer</h2>
            <ul>
              <li>Stock disponible sur la période et nombre d&apos;appareils par logement</li>
              <li>Accès, étages, stationnement, créneaux par adresse</li>
              <li>Capacité électrique : à confirmer par une personne compétente, logement par logement</li>
              <li>ERP / écoles : validation préalable du responsable du site</li>
            </ul>
            <p className="small muted">Les gros volumes et les demandes multi-sites sont chiffrés sur devis, après vérification de la logistique réelle.</p>
          </div>
        </div>
      </section>
    </>
  );
}
