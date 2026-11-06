import Link from "next/link";
import Faq, { commonFaq } from "@/components/Faq";
import { getPublicSettings } from "@/server/public-settings";

export const revalidate = 300;

export default async function Home() {
  const pub = await getPublicSettings();
  const zone = pub?.settings.zones[0]?.label;
  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <p className="eyebrow">Location temporaire · Lyon &amp; Villeurbanne</p>
            <h1>Chauffage ou climatisation temporaire, livré et repris.</h1>
            <p className="lead">
              Panne de chaudière, chantier, logement à dépanner, local trop chaud : nous apportons le matériel sur site et le
              récupérons en fin de location. Estimez votre besoin en ligne, sans paiement ; notre équipe confirme ensuite le stock, le prix et le créneau.
            </p>
            <div className="choice-grid">
              <Link className="choice heat" href="/chauffage">
                <span className="arrow" aria-hidden="true">→</span>
                <strong>J&apos;ai besoin de chauffage</strong>
                <span>Radiateurs à bain d&apos;huile 2 000 W, tarifs affichés</span>
              </Link>
              <Link className="choice cool" href="/climatisation">
                <span className="arrow" aria-hidden="true">→</span>
                <strong>J&apos;ai besoin de climatisation</strong>
                <span>Climatiseurs mobiles — sur devis, disponibilité à confirmer</span>
              </Link>
            </div>
            <ul className="checks">
              <li>Livraison et reprise organisées</li>
              <li>Estimation sans paiement</li>
              <li>Particuliers et professionnels</li>
              <li>Commandes multi-logements</li>
            </ul>
          </div>
          <aside className="hero-card" aria-label="Comment ça marche">
            <h2>Comment ça marche</h2>
            <ol>
              <li><strong>Vous décrivez le besoin</strong> — surface, pièces, isolation, dates souhaitées. Le simulateur propose une quantité indicative.</li>
              <li><strong>Nous vous recontactons</strong> — vérification du stock, de la zone, de la capacité électrique et du créneau, puis confirmation du prix.</li>
              <li><strong>Livraison, puis reprise</strong> — un bon de remise et de reprise est signé sur place. Vous n&apos;avez rien à stocker.</li>
            </ol>
            <p className="tiny" style={{ marginTop: 16, color: "#c9d6d4" }}>Demande de précommande sans paiement, sous réserve de confirmation.</p>
          </aside>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <p className="eyebrow">Pourquoi louer plutôt qu&apos;acheter</p>
          <h2>La logistique, c&apos;est notre travail.</h2>
          <div className="grid-3" style={{ marginTop: 24 }}>
            <div className="card"><span className="num">01</span><h3>Aller ET retour</h3><p>La livraison et la reprise sont prévues dès la demande : pas d&apos;achat d&apos;urgence, pas d&apos;appareils à stocker ou à jeter après la panne.</p></div>
            <div className="card"><span className="num">02</span><h3>Une quantité raisonnée</h3><p>Le simulateur calcule pièce par pièce, et nous vérifions avec vous la capacité électrique avant toute confirmation.</p></div>
            <div className="card"><span className="num">03</span><h3>Un bon signé sur place</h3><p>Matériel, quantité, références d&apos;inventaire, notice remise, état à la livraison et au retour : tout est consigné.</p></div>
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap grid-2" style={{ alignItems: "center" }}>
          <div>
            <p className="eyebrow">Syndics · bailleurs · chauffagistes · entreprises</p>
            <h2>Plusieurs logements à dépanner ?</h2>
            <p>Interlocuteur unique, demande groupée, réceptionnaires différents par logement, bon de livraison et facturation hors site. Nous établissons un devis adapté sans multiplier arbitrairement les frais.</p>
            <Link className="btn secondary" href="/professionnels">Offre professionnels</Link>
          </div>
          <div className="card">
            <h3>Zone de service</h3>
            <p>{zone ? <>Tarifs publiés pour : <strong>{zone}</strong>.</> : "Zone de service : Lyon et Villeurbanne."} Autres communes de la métropole : demande possible, livraison sur devis.</p>
            <p className="small muted">Aucun délai garanti : le créneau est confirmé selon le stock et les tournées.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="narrow">
          <h2>Questions fréquentes</h2>
          <Faq items={commonFaq(zone)} />
          <div className="btn-row" style={{ marginTop: 28 }}>
            <Link className="btn" href="/demande">Estimer mon besoin / Envoyer ma demande</Link>
          </div>
        </div>
      </section>
    </>
  );
}
