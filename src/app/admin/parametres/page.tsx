import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { getActiveSettings, listSettingsVersions } from "@/server/settings-store";
import { formatDateTime } from "@/lib/format";
import SettingsForm from "./SettingsForm";

export default async function Parametres() {
  await requireUser(["admin"]);
  const db = getDb();
  const [active, versions] = await Promise.all([getActiveSettings(db), listSettingsVersions(db)]);
  return (
    <>
      <h1>Tarifs et paramètres métier</h1>
      <p className="small muted">Version active : <strong>v{active.version}</strong> (publiée le {formatDateTime(active.createdAt)}). Chaque publication crée une nouvelle version immuable ; les demandes déjà reçues gardent le prix figé de leur version. Montants en centimes HT (ex. 8800 = 88,00 €). Taux de TVA en points de base (2000 = 20 %).</p>
      <div className="detail-grid">
        <SettingsForm initial={active.settings} />
        <section className="box">
          <h2>Historique des versions</h2>
          <ul className="timeline">{versions.map((v) => <li key={v.id}>v{v.version} {v.isActive && <span className="badge s-confirmee">active</span>} · {formatDateTime(v.createdAt)}<br /><span className="small">{v.note}</span></li>)}</ul>
        </section>
      </div>
    </>
  );
}
