import Link from "next/link";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { dashboardCounts, listRequests } from "@/server/admin-data";
import { launchReadiness, effectiveSiteMode, publicPreproductionRisk } from "@/server/env";
import { getActiveSettings } from "@/server/settings-store";
import { processDueNotifications } from "@/server/notifications";
import { formatDateTime } from "@/lib/format";
import { RequestTable, StatusBadge } from "./ui";
import { retryNotificationsAction } from "./actions";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  await requireUser();
  const db = getDb();
  // Rattrapage opportuniste des emails en attente à chaque ouverture du tableau de bord
  await processDueNotifications(db, { limit: 10 }).catch(() => []);
  const [{ counts, notif, incidents, openIncidents, deliveries, pickups, overdue }, latest, active] = await Promise.all([
    dashboardCounts(db),
    listRequests(db, { view: "actives" }, [], 15),
    getActiveSettings(db),
  ]);
  const readiness = launchReadiness();
  const mode = effectiveSiteMode();
  const { erreur } = await searchParams;
  const tile = (v: number, l: string, href: string, alert = false) => (
    <Link className={`kpi ${alert && v > 0 ? "alert" : ""}`} href={href}><span className="v">{v}</span><span className="l">{l}</span></Link>
  );
  return (
    <>
      <h1>Tableau de bord</h1>
      {erreur === "droits" && <div className="notice danger flash"><p>Votre rôle ne donne pas accès à cette page.</p></div>}
      {(notif.dead > 0 || notif.failed > 0) && (
        <div className="notice danger flash" role="alert">
          <p><strong>Emails non envoyés :</strong> {notif.failed} en échec (nouvelle tentative programmée), {notif.dead} abandonné(s) après plusieurs tentatives. Les demandes sont bien enregistrées ; contactez les clients concernés si nécessaire.</p>
          <form action={retryNotificationsAction}><input type="hidden" name="return" value="/admin" /><button className="btn small">Relancer les envois maintenant</button> <Link href="/admin/notifications">Voir le détail</Link></form>
        </div>
      )}
      {publicPreproductionRisk() && (
        <div className="notice danger flash" role="alert"><p><strong>Pré-production accessible publiquement</strong> (HTTPS sans PREVIEW_PASSWORD) : de vraies personnes peuvent envoyer des données. Définissez PREVIEW_PASSWORD ou finalisez l&apos;ouverture.</p></div>
      )}
      <div className="kpis">
        {tile(counts.nouvelles, "Nouvelles demandes", "/admin/demandes?status=nouvelle_demande")}
        {tile(counts.a_appeler, "À appeler", "/admin/demandes?view=a_appeler", true)}
        {tile(counts.devis, "Devis à confirmer", "/admin/demandes?status=devis_a_confirmer")}
        {tile(counts.confirmees, "Confirmées", "/admin/demandes?status=confirmee")}
        {tile(counts.livraisons, "Livraisons à faire", "/admin/demandes?status=preparation")}
        {tile(counts.reprises_a_programmer, "Reprises à programmer", "/admin/demandes?status=livree")}
        {tile(counts.revues, "Études / revues manuelles", "/admin/demandes?view=actives")}
        {tile(counts.sans_contact_24h, "Demandes > 24 h sans contact", "/admin/demandes?view=a_appeler", true)}
        {tile(counts.relances, "Relances dues", "/admin/demandes?view=relances", true)}
        {tile(counts.incidents_ouverts, "Incidents ouverts (notice / signature)", "/admin#incidents", true)}
        {tile(counts.remises_sans_scan, "Remises sans scan du bon signé", "/admin/demandes?status=livree", true)}
        {tile(counts.a_controler, "Appareils à contrôler", "/admin/materiel#controles", true)}
        {tile(counts.reprises_en_retard, `Reprises en retard (${counts.appareils_en_retard} app.)`, "/admin/demandes?status=livree", true)}
        {tile(counts.remises_en_retard, "Remises non constatées (J+1)", "/admin/demandes?status=preparation", true)}
      </div>
      <div className="detail-grid">
        <div>
          <div className="box">
            <h2>Demandes en cours</h2>
            <RequestTable rows={latest} />
            <p style={{ marginTop: 10 }}><Link href="/admin/demandes">Toutes les demandes, recherche et export →</Link></p>
          </div>
        </div>
        <div>
          {openIncidents.length > 0 && (
            <div className="box" id="incidents" style={{ borderColor: "var(--danger)" }}>
              <h2>Incidents ouverts</h2>
              <ul className="timeline">{openIncidents.map(({ i, ref }) => <li key={i.id}><Link href={`/admin/demandes/${i.requestId}#incidents`}>{ref}</Link> · {formatDateTime(i.reportedAt)} · <strong>{({ notice_non_remise: "Notice non remise", refus_signature: "Refus de signature", signature_non_recueillie: "Signature non recueillie", autre: "Autre" } as Record<string, string>)[i.kind]}</strong><br /><span className="small">Consignes : {i.resolutionInstructions}</span></li>)}</ul>
            </div>
          )}
          {overdue.length > 0 && (
            <div className="box" style={{ borderColor: "var(--danger)" }}>
              <h2>Reprises en retard — matériel bloqué</h2>
              <p className="small">Ces appareils restent indisponibles jusqu&apos;au constat de reprise. Prolongez la reprise prévue (Planning) ou organisez la reprise.</p>
              <ul className="timeline">{overdue.map((o) => <li key={o.id}><Link href={`/admin/demandes/${o.id}`}>{o.reference}</Link> · prévue le {formatDateTime(o.end_at)} · {o.n} appareil(s) · {o.city}</li>)}</ul>
            </div>
          )}
          <div className="box">
            <h2>Livraisons à faire</h2>
            {deliveries.length === 0 ? <p className="muted small">Aucune.</p> : (
              <ul className="timeline">{deliveries.map((d) => <li key={d.id}><Link href={`/admin/demandes/${d.id}`}>{d.reference}</Link> · {d.at ? formatDateTime(d.at) : "créneau non fixé"} · {d.city} · {d.qty ?? "?"} app. <StatusBadge s={d.status} /></li>)}</ul>
            )}
          </div>
          <div className="box">
            <h2>Reprises</h2>
            {pickups.length === 0 ? <p className="muted small">Aucune.</p> : (
              <ul className="timeline">{pickups.map((d) => <li key={d.id}><Link href={`/admin/demandes/${d.id}`}>{d.reference}</Link> · {d.at ? formatDateTime(d.at) : "à programmer"} · {d.city} <StatusBadge s={d.status} /></li>)}</ul>
            )}
          </div>
          <div className="box">
            <h2>Derniers incidents</h2>
            {incidents.length === 0 ? <p className="muted small">Aucun incident saisi.</p> : (
              <ul className="timeline">{incidents.map((i) => <li key={i.id}><Link href={`/admin/demandes/${i.id}`}>{i.reference}</Link> — {i.note}</li>)}</ul>
            )}
          </div>
          <div className="box">
            <h2>Ouverture commerciale</h2>
            <p className="small">Mode effectif : <strong>{mode === "production" ? "production (public, indexé)" : "pré-production (non indexé)"}</strong> · grille active v{active.version}</p>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {readiness.map((r) => <li key={r.label} style={{ color: r.ok ? "var(--ok)" : "var(--danger)" }}>{r.ok ? "✓" : "✗"} {r.label}</li>)}
            </ul>
            <p className="tiny muted">Le mode production n&apos;est activé que si SITE_MODE=production ET toutes les lignes sont vertes.</p>
          </div>
        </div>
      </div>
    </>
  );
}
