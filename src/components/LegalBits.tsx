export function V({ value, label }: { value?: string | null; label: string }) {
  return value ? <>{value}</> : <span className="todo">[À COMPLÉTER : {label}]</span>;
}

export function DraftBanner({ validated, missing }: { validated: boolean; missing: number }) {
  if (validated && missing === 0) return null;
  return (
    <div className="notice warn" role="note" style={{ marginBottom: 24 }}>
      <p><strong>Modèle non publiable en l&apos;état.</strong> {missing > 0 ? `${missing} information(s) obligatoire(s) manquante(s). ` : ""}
        {!validated ? "Texte à faire relire et valider (juriste, assureur) avant toute commercialisation. " : ""}
        Tant que ces éléments ne sont pas fournis, le site reste en mode pré-production (non indexé).</p>
    </div>
  );
}
