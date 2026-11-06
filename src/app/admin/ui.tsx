import Link from "next/link";
import { STATUS_LABEL, type RequestStatus } from "@/lib/domain/status";
import { formatDateTime, formatEuros, formatIsoDate } from "@/lib/format";

export function StatusBadge({ s }: { s: RequestStatus }) {
  return <span className={`badge s-${s}`}>{STATUS_LABEL[s]}</span>;
}

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (ok) return <div className="notice ok flash" role="status"><p>{ok}</p></div>;
  if (err) return <div className="notice danger flash" role="alert"><p>{err}</p></div>;
  return null;
}

type Row = Awaited<ReturnType<typeof import("@/server/admin-data").listRequests>>[number];

export function RequestTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return <p className="muted">Aucune demande.</p>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr><th>Réf.</th><th>Reçue</th><th>Statut</th><th>Service</th><th>Donneur d&apos;ordre</th><th>Lieu</th><th>Début souhaité</th><th>Qté</th><th>Estimation</th><th>Alertes</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/admin/demandes/${r.id}`}><strong>{r.reference}</strong></Link></td>
              <td>{formatDateTime(r.createdAt)}</td>
              <td><StatusBadge s={r.status} /></td>
              <td>{r.service}</td>
              <td>{r.companyName ? <>{r.companyName}<br /></> : null}<span className="small">{r.contactName} · {r.customerKind}</span></td>
              <td>{r.postalCode} {r.city}</td>
              <td>{formatIsoDate(r.desiredStartDate)}{r.estimatedDays ? ` · ${r.estimatedDays} j` : " · ?"}</td>
              <td>{r.quantityRequested ?? "—"}{r.quantityRecommended != null && r.quantityRecommended !== r.quantityRequested ? <span className="small muted"> (rec. {r.quantityRecommended})</span> : null}</td>
              <td>{r.quoteMode === "estimate" ? `${formatEuros(r.totalHt)} HT` : <span className="badge">sur devis</span>}</td>
              <td>
                {!r.firstContactAt && ["nouvelle_demande", "a_qualifier"].includes(r.status) && <span className="badge warn">à appeler</span>}{" "}
                {r.requiresManualReview && <span className="badge warn">étude</span>}{" "}
                {r.isErp && <span className="badge danger">ERP</span>}{" "}
                {r.expressRequested && <span className="badge">express</span>}{" "}
                {r.multiSite && <span className="badge">multi-sites</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
