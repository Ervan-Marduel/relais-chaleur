import type { Metadata } from "next";
import { DraftBanner, V } from "@/components/LegalBits";
import { env, LEGAL_REQUIRED } from "@/server/env";

export const metadata: Metadata = { title: "Conditions de la demande et de la location", alternates: { canonical: "/conditions" } };
export const dynamic = "force-dynamic";

export default function Conditions() {
  const e = env();
  const missing = LEGAL_REQUIRED.filter((r) => !e[r.key]).length;
  return (
    <div className="narrow legal">
      <h1>Conditions de la demande et de la location</h1>
      <DraftBanner validated={e.LEGAL_TEXTS_VALIDATED === "true"} missing={missing} />
      <p className="small muted">Version de travail CGL-brouillon-2026-11 — <strong>modèle à faire valider par un juriste et l&apos;assureur</strong>. Les conditions générales de location définitives (CGL/CGV) seront remises avec le devis.</p>
      <h2>1. Nature de la demande en ligne</h2>
      <p>Le site permet d&apos;envoyer une <strong>demande de précommande / estimation sans paiement</strong>. Elle n&apos;engage ni le client ni <V value={e.LEGAL_COMPANY_NAME} label="exploitant" /> : la location n&apos;est formée qu&apos;après confirmation expresse par l&apos;exploitant (stock, zone, capacité électrique discutée, prix, créneau) et acceptation du devis par le donneur d&apos;ordre. Aucun paiement, prélèvement ni dépôt de garantie n&apos;est réalisé sur le site.</p>
      <h2>2. Prix</h2>
      <p>Les prix affichés sont indicatifs et issus de la grille en vigueur au moment de la demande ; ils sont figés dans la demande à titre d&apos;estimation. Électricité non incluse. Les cas hors grille (zone, quantité, durée inconnue ou longue, multi-sites, ERP) font l&apos;objet d&apos;un devis. La TVA indiquée est indicative et dépend du statut du loueur.</p>
      <h2>3. Durée</h2>
      <p>La durée facturable est déterminée à partir des dates réelles de mise à disposition et de reprise figurant sur le bon de remise et de reprise, selon la règle de décompte précisée au devis <span className="todo">[À COMPLÉTER : règle de décompte des jours]</span>.</p>
      <h2>4. Livraison, remise et reprise</h2>
      <p>Le créneau est convenu avec le réceptionnaire ; aucun délai n&apos;est garanti. Un bon unique de remise et de reprise est signé sur place. La signature du réceptionnaire prouve la réception du matériel et de la notice ; elle ne lui transfère pas les obligations de paiement du donneur d&apos;ordre. La livraison ne vaut ni installation ni autorisation électrique.</p>
      <h2>5. Sécurité et utilisation</h2>
      <p>L&apos;utilisateur respecte la notice du fabricant remise avec le matériel (distances, surveillance, pas de couverture, pas de multiprise ni rallonge sauf autorisation expresse conforme à la notice). La capacité électrique du site doit être vérifiée par une personne compétente. ERP / écoles : aucune utilisation avant validation de l&apos;admissibilité et de l&apos;implantation par le responsable du site.</p>
      <h2>6. Responsabilités</h2>
      <p>Les responsabilités respectives du loueur et du client/occupant (notamment en cas de non-respect établi des notices, de défaut du matériel ou de manquement à l&apos;information) seront précisées dans les CGL définitives. <span className="todo">[À COMPLÉTER après revue juridique et assurance]</span></p>
      <h2>7. Consommateurs</h2>
      <p><span className="todo">[À COMPLÉTER : informations précontractuelles consommateurs, droit de rétractation ou exception applicable (prestation exécutée à date déterminée / à la demande expresse), médiateur]</span></p>
    </div>
  );
}
