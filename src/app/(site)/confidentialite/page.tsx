import type { Metadata } from "next";
import { DraftBanner, V } from "@/components/LegalBits";
import { env, LEGAL_REQUIRED } from "@/server/env";

export const metadata: Metadata = { title: "Politique de confidentialité", alternates: { canonical: "/confidentialite" } };
export const dynamic = "force-dynamic";

export default function Confidentialite() {
  const e = env();
  const missing = LEGAL_REQUIRED.filter((r) => !e[r.key]).length;
  return (
    <div className="narrow legal">
      <h1>Politique de confidentialité</h1>
      <DraftBanner validated={e.LEGAL_TEXTS_VALIDATED === "true"} missing={missing} />
      <p className="small muted">Version de travail CONF-brouillon-2026-11 — à valider.</p>
      <h2>Responsable du traitement</h2>
      <p><V value={e.LEGAL_COMPANY_NAME} label="raison sociale" />, <V value={e.LEGAL_ADDRESS} label="adresse" />, contact : <V value={e.LEGAL_EMAIL} label="email" />.</p>
      <h2>Données collectées et finalités</h2>
      <ul>
        <li><strong>Demande de précommande</strong> : type de client, nom ou raison sociale, SIRET éventuel, contact, téléphone, email, adresse de facturation facultative ; lieu de livraison, nom et téléphone de la personne qui réceptionne ; caractéristiques du besoin (surface, pièces, isolation, dates). Finalité : étudier la demande, vous recontacter, établir un devis, organiser la livraison et la reprise. Base légale : mesures précontractuelles prises à votre demande ; pour le réceptionnaire, intérêt légitime à organiser la remise du matériel (le donneur d&apos;ordre s&apos;engage à l&apos;informer).</li>
        <li><strong>Mesure d&apos;audience</strong> : événements anonymes (page vue, étape de l&apos;assistant) associés à un identifiant aléatoire propre à l&apos;onglet, sans cookie, sans adresse IP, et paramètres de campagne (UTM). Finalité : améliorer le service.</li>
        <li><strong>Sécurité</strong> : empreinte non réversible de l&apos;adresse IP pour limiter les abus (anti-spam, limitation de débit), conservée quelques minutes à quelques heures.</li>
      </ul>
      <h2>Destinataires</h2>
      <p>Personnel habilité de l&apos;exploitant ; sous-traitants techniques : hébergement du site (Vercel), base de données <span className="todo">[À COMPLÉTER : prestataire et région]</span>, envoi d&apos;emails transactionnels (Resend){process.env.TURNSTILE_SECRET_KEY ? ", protection anti-robot (Cloudflare Turnstile)" : ""}. Aucune revente, aucune prospection par des tiers.</p>
      <h2>Durées de conservation (proposées, à valider)</h2>
      <ul>
        <li>Demande non suivie de commande : 3 ans à compter du dernier contact, puis anonymisation.</li>
        <li>Commande, bon de remise et de reprise, scans du bon signé, constats et photos : durée de la relation puis 5 ans (prescription de droit commun), prolongée en cas de litige ou de sinistre en cours ; pièces comptables : 10 ans. Ces documents sont chiffrés et accessibles aux seules personnes habilitées, chaque consultation étant journalisée.</li>
        <li>Journaux techniques et limitation de débit : 12 mois au plus.</li>
      </ul>
      <h2>Vos droits</h2>
      <p>Accès, rectification, effacement, limitation, opposition et portabilité : écrivez à <V value={e.LEGAL_EMAIL} label="email de contact" /> en rappelant votre référence de demande. Vous pouvez saisir la CNIL (www.cnil.fr).</p>
      <h2>Stockage local</h2>
      <p>Pendant la saisie, l&apos;assistant conserve votre brouillon <strong>sur votre appareil</strong> (stockage local du navigateur) pour éviter toute perte ; il n&apos;est transmis qu&apos;au clic sur « Envoyer ma demande » et effacé après l&apos;envoi réussi.</p>
    </div>
  );
}
