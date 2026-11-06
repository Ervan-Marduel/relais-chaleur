import Link from "next/link";
import { publicSiteInfo } from "@/server/site";
import Track from "@/components/Track";
import NavLinks from "@/components/NavLinks";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const s = publicSiteInfo();
  return (
    <>
      <a className="skip" href="#contenu">Aller au contenu</a>
      {s.mode !== "production" && (
        <div className="preprod" role="note">
          Site en <strong>pré-production</strong> : informations légales et validations en cours. Les demandes de test ne valent pas commande.
        </div>
      )}
      <header className="site-header">
        <div className="wrap">
          <Link href="/" className="brand" aria-label={`${s.brand} — accueil`}>
            <span className="brand-mark" aria-hidden="true" />
            <span>Relais Chaleur <small>Lyon</small></span>
          </Link>
          <nav className="nav" aria-label="Navigation principale">
            <NavLinks />
            <Link className="btn small" href="/demande">Estimer mon besoin</Link>
          </nav>
        </div>
      </header>
      <main id="contenu">{children}</main>
      <footer className="site-footer">
        <div className="wrap">
          <div className="cols">
            <div>
              <h2>{s.brand}</h2>
              <p>Chauffage d&apos;appoint et climatisation mobile en location temporaire, livrés et repris sur site, dans la zone de service affichée.</p>
              <p className="tiny">
                Demande de précommande / estimation sans paiement, sous réserve de confirmation. Électricité non incluse.
                {s.email ? <> Contact : <a href={`mailto:${s.email}`}>{s.email}</a>.</> : null}
                {s.phone ? <> Téléphone : <a href={`tel:${s.phone.replace(/\s/g, "")}`}>{s.phone}</a>.</> : null}
              </p>
            </div>
            <div>
              <h2>Services</h2>
              <ul>
                <li><Link href="/chauffage">Location de radiateurs</Link></li>
                <li><Link href="/climatisation">Climatisation mobile</Link></li>
                <li><Link href="/professionnels">Syndics et professionnels</Link></li>
                <li><Link href="/demande">Faire une demande</Link></li>
              </ul>
            </div>
            <div>
              <h2>Informations</h2>
              <ul>
                <li><Link href="/mentions-legales">Mentions légales</Link></li>
                <li><Link href="/confidentialite">Confidentialité</Link></li>
                <li><Link href="/conditions">Conditions de location</Link></li>
              </ul>
            </div>
          </div>
        </div>
      </footer>
      <Track />
    </>
  );
}
