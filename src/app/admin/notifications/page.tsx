import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { notifications, requests } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { formatDateTime } from "@/lib/format";
import { retryNotificationsAction } from "../actions";

export default async function Notifications() {
  await requireUser();
  const rows = await getDb()
    .select({ n: notifications, ref: requests.reference, rid: requests.id })
    .from(notifications).leftJoin(requests, eq(notifications.requestId, requests.id))
    .orderBy(desc(notifications.createdAt)).limit(200);
  const e = env();
  return (
    <>
      <h1>Notifications email</h1>
      <p className="small muted">Transport : <strong>{e.EMAIL_DRIVER}</strong>{e.EMAIL_DRIVER !== "resend" && " (aucun email réel n'est envoyé)"} · destinataire équipe : {e.TEAM_NOTIFICATION_EMAIL ?? <span className="badge danger">non configuré</span>}. Les échecs sont retentés automatiquement (1 min, 5 min, 15 min, 1 h…) puis marqués « dead » après 8 tentatives.</p>
      <form action={retryNotificationsAction} style={{ marginBottom: 12 }}><input type="hidden" name="return" value="/admin/notifications" /><button className="btn small">Traiter la file maintenant</button></form>
      <div className="table-wrap"><table className="data">
        <thead><tr><th>Créée</th><th>Demande</th><th>Type</th><th>Statut</th><th>Tentatives</th><th>Prochaine tentative</th><th>Dernière erreur</th><th></th></tr></thead>
        <tbody>{rows.map(({ n, ref, rid }) => (
          <tr key={n.id}>
            <td>{formatDateTime(n.createdAt)}</td>
            <td>{rid ? <Link href={`/admin/demandes/${rid}`}>{ref}</Link> : "—"}</td>
            <td>{n.kind === "client_ack" ? "Accusé client" : "Alerte équipe"}</td>
            <td><span className={`badge ${n.status === "sent" ? "s-confirmee" : n.status === "dead" || n.status === "failed" ? "danger" : "warn"}`}>{n.status}</span></td>
            <td>{n.attempts}</td>
            <td>{n.status === "sent" ? formatDateTime(n.sentAt) : formatDateTime(n.nextAttemptAt)}</td>
            <td className="small">{n.lastError ?? ""}</td>
            <td>{(n.status === "failed" || n.status === "dead") && <form action={retryNotificationsAction}><input type="hidden" name="notificationId" value={n.id} /><input type="hidden" name="return" value="/admin/notifications" /><button className="btn small ghost">Renvoyer</button></form>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}
