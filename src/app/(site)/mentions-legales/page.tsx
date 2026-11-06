import type { Metadata } from "next";
import { DraftBanner, V } from "@/components/LegalBits";
import { env, LEGAL_REQUIRED } from "@/server/env";

export const metadata: Metadata = { title: "Mentions légales", alternates: { canonical: "/mentions-legales" } };
export const dynamic = "force-dynamic";

export default function MentionsLegales() {
  const e = env();
  const missing = LEGAL_REQUIRED.filter((r) => !e[r.key]).length;
  return (
    <div className="narrow legal">
      <h1>Mentions légales</h1>
      <DraftBanner validated={e.LEGAL_TEXTS_VALIDATED === "true"} missing={missing} />
      <h2>Éditeur du site</h2>
      <p>
        <V value={e.LEGAL_COMPANY_NAME} label="raison sociale ou nom de l'exploitant" /> — <V value={e.LEGAL_FORM} label="forme juridique et capital" /><br />
        SIREN / SIRET : <V value={e.LEGAL_SIREN} label="SIREN/SIRET" />{e.LEGAL_RCS ? <> — {e.LEGAL_RCS}</> : null}<br />
        Siège : <V value={e.LEGAL_ADDRESS} label="adresse du siège" /><br />
        Contact : <V value={e.LEGAL_EMAIL} label="email" />{e.LEGAL_PHONE ? <> — {e.LEGAL_PHONE}</> : null}<br />
        {e.LEGAL_VAT_NUMBER ? <>N° TVA intracommunautaire : {e.LEGAL_VAT_NUMBER}<br /></> : null}
        Directeur de la publication : <V value={e.LEGAL_PUBLICATION_DIRECTOR} label="directeur de la publication" />
      </p>
      <p className="small muted">Nom commercial utilisé : {e.BRAND_NAME} (marque de travail, disponibilité à vérifier auprès de l&apos;INPI avant publication).</p>
      <h2>Hébergement</h2>
      <p>{e.LEGAL_HOST}. Base de données : <span className="todo">[À COMPLÉTER : hébergeur de la base, ex. Supabase — région UE]</span>.</p>
      <h2>Assurance</h2>
      <p>Responsabilité civile professionnelle / location : <V value={e.LEGAL_INSURANCE} label="assureur et couverture" />.</p>
      <h2>Propriété intellectuelle</h2>
      <p>Les contenus du site sont la propriété de l&apos;éditeur, sauf mention contraire. Les marques des fabricants citées appartiennent à leurs titulaires.</p>
      <h2>Médiation de la consommation</h2>
      <p><span className="todo">[À COMPLÉTER si clientèle de particuliers : médiateur de la consommation désigné et coordonnées]</span></p>
    </div>
  );
}
