import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { listRequests, type RequestFilters } from "@/server/admin-data";
import { getActiveSettings } from "@/server/settings-store";
import { REQUEST_STATUSES, STATUS_LABEL } from "@/lib/domain/status";
import { RequestTable } from "../ui";

export default async function Demandes({ searchParams }: { searchParams: Promise<RequestFilters> }) {
  await requireUser();
  const f = await searchParams;
  const db = getDb();
  const settings = (await getActiveSettings(db)).settings;
  const zonePcs = settings.zones.flatMap((z) => z.postalCodes);
  const rows = await listRequests(db, f, zonePcs);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => typeof v === "string" && v) as [string, string][]).toString();
  return (
    <>
      <h1>Demandes</h1>
      <form className="filters" method="get">
        <label className="field"><span className="label small">Recherche</span><input type="search" name="q" defaultValue={f.q} placeholder="Réf., nom, email, tél., adresse…" /></label>
        <label className="field"><span className="label small">Statut</span>
          <select name="status" defaultValue={f.status ?? ""}><option value="">Tous</option>{REQUEST_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        <label className="field"><span className="label small">Produit</span>
          <select name="service" defaultValue={f.service ?? ""}><option value="">Tous</option><option value="chauffage">Chauffage</option><option value="climatisation">Climatisation</option></select></label>
        <label className="field"><span className="label small">Segment</span>
          <select name="segment" defaultValue={f.segment ?? ""}><option value="">Tous</option><option value="particulier">Particulier</option><option value="entreprise">Entreprise</option><option value="syndic">Syndic / bailleur</option><option value="autre">Autre</option></select></label>
        <label className="field"><span className="label small">Zone</span>
          <select name="zone" defaultValue={f.zone ?? ""}><option value="">Toutes</option><option value="in">Zone tarifée</option><option value="out">Hors zone</option></select></label>
        <label className="field"><span className="label small">Début souhaité du</span><input type="date" name="from" defaultValue={f.from} /></label>
        <label className="field"><span className="label small">au</span><input type="date" name="to" defaultValue={f.to} /></label>
        <button className="btn small">Filtrer</button>
        <a className="btn small secondary" href={`/api/admin/export${qs ? `?${qs}` : ""}`}>Exporter CSV</a>
      </form>
      <p className="small muted">{rows.length} demande(s){rows.length === 200 ? " (200 premières — affinez la recherche)" : ""}.</p>
      <RequestTable rows={rows} />
    </>
  );
}
