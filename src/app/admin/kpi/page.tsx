import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { kpis } from "@/server/admin-data";
import { formatEuros } from "@/lib/format";

export default async function Kpi({ searchParams }: { searchParams: Promise<{ jours?: string }> }) {
  await requireUser();
  const days = Math.min(365, Math.max(7, Number((await searchParams).jours) || 30));
  const k = await kpis(getDb(), days);
  const ev = (n: string) => k.funnel.find((f) => f.name === n)?.sessions ?? 0;
  const o = k.ops;
  const steps = [
    { l: "Visiteurs (pages service)", v: ev("view_service") },
    { l: "Début de simulateur", v: ev("start_estimator") },
    { l: "Estimation affichée", v: ev("estimate_shown") },
    { l: "Début de demande", v: ev("start_request") },
    { l: "Demandes reçues (après enregistrement)", v: Number(o.demandes ?? 0) },
    { l: "Demandes qualifiées", v: Number(o.qualifiees ?? 0) },
    { l: "Confirmations", v: Number(o.confirmees ?? 0) },
    { l: "Commandes livrées", v: Number(o.livrees ?? 0) },
    { l: "Reprises effectuées", v: Number(o.reprises ?? 0) },
  ];
  const max = Math.max(1, ...steps.map((s) => s.v));
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "—");
  return (
    <>
      <h1>Indicateurs — {days} derniers jours</h1>
      <form method="get" className="filters"><label className="field"><span className="label small">Période (jours)</span><input type="number" name="jours" defaultValue={days} min={7} max={365} /></label><button className="btn small">Afficher</button></form>
      <section className="box">
        <h2>Entonnoir</h2>
        <p className="tiny muted">Mesure sans cookie : sessions d&apos;onglet anonymes. « Demandes reçues » est compté uniquement après enregistrement en base.</p>
        <table className="data"><tbody>
          {steps.map((s, i) => (
            <tr key={s.l}><td style={{ width: "34%" }}>{s.l}</td><td style={{ width: 70 }}><strong>{s.v}</strong></td><td style={{ width: 80 }} className="small muted">{i > 0 ? pct(s.v, steps[i - 1].v) : ""}</td><td><div className="funnel-bar" style={{ width: `${(s.v / max) * 100}%` }} /></td></tr>
          ))}
        </tbody></table>
      </section>
      <div className="kpis">
        <div className="kpi"><span className="v">{o.panier_moyen_ht != null ? formatEuros(Number(o.panier_moyen_ht)) : "—"}</span><span className="l">Panier estimé moyen HT</span></div>
        <div className="kpi"><span className="v">{o.qte_moyenne ?? "—"}</span><span className="l">Appareils par demande</span></div>
        <div className="kpi"><span className="v">{o.delai_contact_h ?? "—"} h</span><span className="l">Délai moyen de 1er contact</span></div>
        <div className="kpi"><span className="v">{o.delai_confirmation_h ?? "—"} h</span><span className="l">Délai moyen de confirmation</span></div>
        <div className="kpi"><span className="v">{pct(Number(o.confirmees ?? 0), Number(o.qualifiees ?? 0))}</span><span className="l">Conversion qualifiée → confirmée</span></div>
        <div className="kpi"><span className="v">{k.fleet.units ? pct(k.fleet.busy, k.fleet.units) : "—"}</span><span className="l">Occupation du parc (maintenant) — {k.fleet.busy}/{k.fleet.units}</span></div>
        <div className="kpi"><span className="v">{o.cout_logistique != null ? formatEuros(Number(o.cout_logistique)) : "—"}</span><span className="l">Coût logistique réel saisi</span></div>
        <div className="kpi"><span className="v">{o.km ?? "—"}</span><span className="l">km saisis</span></div>
        <div className="kpi"><span className="v">{o.cout_incidents != null ? formatEuros(Number(o.cout_incidents)) : "—"}</span><span className="l">Coût des incidents</span></div>
      </div>
      <div className="grid-2">
        <Table title="Par segment" rows={k.bySegment} />
        <Table title="Par source (UTM)" rows={k.bySource} />
        <Table title="Par produit" rows={k.byService} />
        <Table title="Par code postal" rows={k.byZone} />
        <Table title="Raisons de refus" rows={k.refusals} />
      </div>
      <p className="small"><a href="/api/admin/export">Exporter toutes les demandes (CSV)</a> pour une analyse détaillée.</p>
    </>
  );
}

function Table({ title, rows }: { title: string; rows: { k: string; n: number; confirmed?: number }[] }) {
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "—");
  return (
    <section className="box"><h2>{title}</h2>
      <table className="data"><thead><tr><th>Valeur</th><th>Demandes</th>{rows[0]?.confirmed !== undefined && <th>Confirmées</th>}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.k}><td>{r.k}</td><td>{r.n}</td>{r.confirmed !== undefined && <td>{r.confirmed} ({pct(r.confirmed, r.n)})</td>}</tr>)}</tbody></table>
    </section>
  );
}
