import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { adminUsers, allocations, equipmentModels, equipmentUnits, requests, unitInspections } from "@/db/schema";
import { desc } from "drizzle-orm";
import { INSPECTION_CHECKS } from "@/server/request-ops";
import { requireUser } from "@/server/auth";
import { formatDateTime } from "@/lib/format";
import { Flash } from "../ui";
import { inspectionAction, modelAction, unitConditionAction, unitsAction } from "../actions";

export default async function Materiel({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireUser();
  const { ok, err } = await searchParams;
  const db = getDb();
  const models = await db.select().from(equipmentModels).orderBy(asc(equipmentModels.service), asc(equipmentModels.brand));
  const open = await db.select({ unitId: allocations.unitId, status: allocations.status, ref: requests.reference, rid: requests.id, endAt: allocations.endAt })
    .from(allocations).innerJoin(requests, eq(allocations.requestId, requests.id)).where(inArray(allocations.status, ["reservee", "remise"]));
  const openByUnit = new Map(open.map((o) => [o.unitId, o]));
  const inspections = await db.select({ i: unitInspections, code: equipmentUnits.inventoryCode, by: adminUsers.name })
    .from(unitInspections).innerJoin(equipmentUnits, eq(unitInspections.unitId, equipmentUnits.id)).innerJoin(adminUsers, eq(unitInspections.recordedBy, adminUsers.id))
    .orderBy(desc(unitInspections.recordedAt)).limit(30);
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const units = await db.select({ u: equipmentUnits, m: equipmentModels }).from(equipmentUnits).innerJoin(equipmentModels, eq(equipmentUnits.modelId, equipmentModels.id)).orderBy(asc(equipmentUnits.inventoryCode));
  return (
    <>
      <h1>Catalogue et parc matériel</h1>
      <Flash ok={ok} err={err} />
      <p className="small muted">Les références de modèle ne sont jamais figées dans le code : sélectionnez-les ici. Chaque appareil reçoit un identifiant interne unique (RC-001…). Un numéro de lot est commun à plusieurs appareils et n&apos;est jamais utilisé comme numéro de série. La disponibilité n&apos;est promise qu&apos;après contrôle humain.</p>
      <div className="detail-grid">
        <div>
          <section className="box" id="controles" style={{ borderColor: "var(--warn)" }}>
            <h2>Contrôle technique — appareils en attente ({units.filter(({ u }) => u.active && (u.condition === "a_controler" || u.condition === "hors_service") && !openByUnit.get(u.id)).length})</h2>
            <p className="small muted">Après chaque retour (même d&apos;apparence conforme) et à la réception, un appareil reste non louable jusqu&apos;à un contrôle positif enregistré ici. Le contrôle et la reprise sont deux traces distinctes et immuables.</p>
            {units.filter(({ u }) => u.active && (u.condition === "a_controler" || u.condition === "hors_service") && !openByUnit.get(u.id)).map(({ u, m }) => (
              <details key={u.id} className="box" style={{ marginBottom: 8 }}>
                <summary><strong>{u.inventoryCode}</strong> — {m.brand} {m.model} · <span className={`badge ${u.condition === "hors_service" ? "danger" : "warn"}`}>{u.condition}</span></summary>
                <form action={inspectionAction} style={{ marginTop: 8 }}>
                  <input type="hidden" name="unitId" value={u.id} />
                  <div className="row-3">
                    <label className="field"><span className="label small">Date du contrôle</span><input type="date" name="date" max={now} required aria-label={`Date du contrôle ${u.inventoryCode}`} /></label>
                    <label className="field"><span className="label small">Heure</span><input type="time" name="time" required aria-label={`Heure du contrôle ${u.inventoryCode}`} /></label>
                    <label className="field"><span className="label small">Contrôleur</span><input type="text" name="inspectorName" required aria-label={`Contrôleur ${u.inventoryCode}`} /></label>
                  </div>
                  {INSPECTION_CHECKS.map((c) => <label key={c.key} className="check small"><input type="checkbox" name={`check_${c.key}`} aria-label={`${u.inventoryCode} — ${c.label}`} /><span>{c.label}</span></label>)}
                  <label className="field"><span className="label small">Anomalies constatées</span><input type="text" name="anomalies" aria-label={`Anomalies ${u.inventoryCode}`} /></label>
                  <label className="field"><span className="label small">Décision</span><select name="decision" required aria-label={`Décision ${u.inventoryCode}`} defaultValue=""><option value="" disabled>— choisir —</option><option value="bon">Bon pour la location</option><option value="neuf">Neuf (réception, jamais loué)</option><option value="hors_service">Hors service</option></select></label>
                  <button className="btn small">Enregistrer le contrôle</button>
                </form>
              </details>
            ))}
            {inspections.length > 0 && (<>
              <h3 style={{ marginTop: 12 }}>Derniers contrôles</h3>
              <ul className="timeline small">{inspections.map(({ i, code, by }) => <li key={i.id}>{formatDateTime(i.inspectedAt)} — <strong>{code}</strong> : {i.conditionBefore} → <strong>{i.decision}</strong> · contrôleur {i.inspectorName} (saisi par {by}){i.anomalies ? ` · anomalies : ${i.anomalies}` : ""}</li>)}</ul>
            </>)}
          </section>
          <section className="box">
            <h2>Modèles ({models.length})</h2>
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Service</th><th>Marque / modèle</th><th>Réf. constructeur</th><th>Puissance</th><th>Notice</th><th>Réf. vérifiée</th></tr></thead>
              <tbody>{models.map((m) => (
                <tr key={m.id}><td>{m.service}</td><td>{m.brand} {m.model}{!m.active && <span className="badge"> inactif</span>}</td><td>{m.manufacturerRef ?? "—"}</td><td>{m.electricalPowerW ? `${m.electricalPowerW} W` : "—"}{m.coolingPowerW ? ` · ${m.coolingPowerW} W froid` : ""}</td><td>{m.noticeUrl ? <a href={m.noticeUrl} target="_blank" rel="noopener">{m.noticeVersion ?? "notice"}</a> : m.noticeVersion ?? <span className="badge warn">à joindre</span>}</td><td>{m.referenceVerified ? "✓" : <span className="badge warn">non</span>}</td></tr>
              ))}</tbody>
            </table></div>
          </section>
          <section className="box">
            <h2>Parc ({units.length} appareils)</h2>
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Réf. interne</th><th>Modèle</th><th>N° série</th><th>Lot</th><th>État</th><th>Disponibilité</th><th>Contrôlé le</th><th>Écarter</th></tr></thead>
              <tbody>{units.map(({ u, m }) => (
                <tr key={u.id}><td><strong>{u.inventoryCode}</strong></td><td>{m.brand} {m.model}</td><td>{u.serialNumber ?? "—"}</td><td>{u.lotNumber ?? "—"}</td><td>{u.condition}</td>
                  <td>{(() => { const o = openByUnit.get(u.id); if (o) return <a href={`/admin/demandes/${o.rid}`}>{o.status === "remise" ? "chez le client" : "réservé"} — {o.ref}</a>; return ["neuf", "bon"].includes(u.condition) && u.active ? <span className="badge s-confirmee">disponible</span> : <span className="badge warn">non louable</span>; })()}</td>
                  <td>{formatDateTime(u.conditionCheckedAt)}</td>
                  <td><details><summary className="small">Mettre à l&apos;écart</summary><form action={unitConditionAction} className="inline-form"><input type="hidden" name="unitId" value={u.id} /><select name="condition" defaultValue="a_controler" aria-label={`Mise à l'écart de ${u.inventoryCode}`}><option value="a_controler">à contrôler</option><option value="hors_service">hors service</option></select><input type="text" name="reason" placeholder="Motif" aria-label={`Motif ${u.inventoryCode}`} required /><button className="btn small ghost">OK</button></form></details></td></tr>
              ))}</tbody>
            </table></div>
          </section>
        </div>
        <div>
          <section className="box">
            <h2>Ajouter un modèle</h2>
            <form action={modelAction}>
              <label className="field"><span className="label small">Service</span><select name="service"><option value="chauffage">Chauffage</option><option value="climatisation">Climatisation</option></select></label>
              <div className="row-2">
                <label className="field"><span className="label small">Marque</span><input type="text" name="brand" required /></label>
                <label className="field"><span className="label small">Modèle</span><input type="text" name="model" required /></label>
              </div>
              <div className="row-2">
                <label className="field"><span className="label small">Réf. constructeur</span><input type="text" name="manufacturerRef" /></label>
                <label className="field"><span className="label small">Puissance électrique (W)</span><input type="number" name="electricalPowerW" /></label>
              </div>
              <label className="field"><span className="label small">Puissance frigorifique (W, clim)</span><input type="number" name="coolingPowerW" /></label>
              <label className="field"><span className="label small">Lien vers la notice (https)</span><input type="text" name="noticeUrl" /></label>
              <label className="field"><span className="label small">Version / intitulé de la notice</span><input type="text" name="noticeVersion" /></label>
              <label className="field"><span className="label small">Restrictions d&apos;implantation</span><textarea name="placementRestrictions" /></label>
              <label className="check small"><input type="checkbox" name="referenceVerified" /><span>Référence vérifiée sur l&apos;appareil et la notice</span></label>
              <button className="btn small">Ajouter le modèle</button>
            </form>
          </section>
          <section className="box">
            <h2>Ajouter un lot d&apos;appareils identiques</h2>
            <form action={unitsAction}>
              <label className="field"><span className="label small">Modèle</span><select name="modelId" required>{models.map((m) => <option key={m.id} value={m.id}>{m.brand} {m.model}</option>)}</select></label>
              <div className="row-2">
                <label className="field"><span className="label small">Quantité</span><input type="number" name="count" min={1} max={100} defaultValue={1} /></label>
                <p className="small muted" style={{ alignSelf: "end" }}>Les appareils entrent « à contrôler » : contrôle de réception obligatoire avant location.</p>
              </div>
              <label className="field"><span className="label small">N° de lot fournisseur (facultatif)</span><input type="text" name="lotNumber" /></label>
              <label className="field"><span className="label small">N° de série constructeur, un par appareil (uniquement s&apos;ils existent réellement)</span><textarea name="serials" placeholder="Laisser vide si aucun n° de série n'est relevé" /></label>
              <button className="btn small">Ajouter</button>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}
