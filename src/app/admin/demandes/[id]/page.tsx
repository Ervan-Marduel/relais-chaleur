import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { equipmentModels } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/server/auth";
import { availableUnits, getRequestDetail } from "@/server/admin-data";
import { BON_ALLOWED_STATUSES } from "@/server/documents";
import { CONFIRMATION_CHECKS, ERP_CHECK, STATUS_LABEL, TRANSITIONS } from "@/lib/domain/status";
import { HEATING_WARNING_TEXT, type HeatingEstimate } from "@/lib/domain/heating";
import { QUOTE_REASON_TEXT, type PriceEstimate } from "@/lib/domain/pricing";
import type { CoolingEstimate } from "@/lib/domain/cooling";
import { CLIENT_KIND_LABEL, PLACE_LABEL } from "@/lib/validation/request";
import { formatDateTime, formatEuros, formatIsoDate, TZ } from "@/lib/format";
import { Flash, StatusBadge } from "../../ui";
import { activityAction, allocateAction, bonAction, cancelReservationAction, deliveryAction, planningAction, quoteAction, resolveIncidentAction, retryNotificationsAction, returnAction, scanAction, statusAction } from "../../actions";
import { DAY_RULE_LABEL, rentalDays } from "@/lib/domain/rental-days";
import { expectedQuantity, INCIDENT_LABEL, PHOTO_MAX_COUNT, SIGNATURE_LABEL, type Signature } from "@/server/request-ops";
import { fileEncryptionEnabled } from "@/server/file-crypto";

const parisParts = (d: Date | null) => {
  if (!d) return { date: "", time: "" };
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (k: string) => f.find((p) => p.type === k)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
};

export default async function DemandeDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { ok, err } = await searchParams;
  const db = getDb();
  const det = await getRequestDetail(db, id);
  if (!det) notFound();
  const { r, c, d } = det;
  const snap = r.estimateSnapshot as { pricingVersion: number; price: PriceEstimate; heating: HeatingEstimate | null; cooling: CoolingEstimate | null };
  const models = await db.select().from(equipmentModels).where(eq(equipmentModels.service, r.service));
  const allowed = TRANSITIONS[r.status];
  const openAllocs = det.allocs.filter(({ a }) => a.status === "reservee" || a.status === "remise");
  const reserved = det.allocs.filter(({ a }) => a.status === "reservee");
  const atClient = det.allocs.filter(({ a }) => a.status === "remise");
  const expected = expectedQuantity(r);
  const canAllocate = ["confirmee", "preparation"].includes(r.status) && !!r.confirmedDeliveryAt && !!r.equipmentModelId && !!expected;
  const free = canAllocate ? await availableUnits(db, r.service) : [];
  const canDeliver = reserved.length > 0 && ["confirmee", "preparation", "livree", "reprise_planifiee"].includes(r.status);
  const nowParis = parisParts(new Date());
  const dayRule = det.acceptedSettings.rental.dayCountRule;
  const delivered = det.allocs.filter(({ a }) => a.deliveredAt);
  const returnedCount = det.allocs.filter(({ a }) => a.status === "retournee").length;
  const reservedModels = [...new Map(reserved.map(({ m }) => [m.id, m])).values()];
  const openIncidents = det.incidents.filter((i) => i.status === "ouvert");
  const partialExecution = expected != null && delivered.length > 0 && delivered.length < expected;
  const encrypted = fileEncryptionEnabled();
  const dl = parisParts(r.confirmedDeliveryAt);
  const pk = parisParts(r.plannedPickupAt);
  const pro = c.kind !== "particulier";
  const need = r.needInput as { heating?: { surfaceMode: string; roomSurfaces?: number[] }; cooling?: Record<string, unknown> };
  const prefill = snap.price.mode === "estimate" ? snap.price.lines : snap.price.partialLines;

  return (
    <>
      <p className="small"><Link href="/admin/demandes">← Demandes</Link></p>
      <h1>{r.reference} <StatusBadge s={r.status} />
        {openIncidents.length > 0 && <> <a href="#incidents" className="badge danger">{openIncidents.length} incident(s) ouvert(s)</a></>}
        {partialExecution && <> <span className="badge warn">exécution partielle : {delivered.length}/{expected} remis</span></>}</h1>
      <p className="small muted">
        {r.service === "chauffage" ? "Chauffage" : "Climatisation"} · reçue le {formatDateTime(r.createdAt)} · grille v{snap.pricingVersion}
        {r.requiresManualReview && <> · <span className="badge warn">étude / revue manuelle</span></>}
        {r.isErp && <> · <span className="badge danger">ERP / école</span></>}
        {r.expressRequested && <> · <span className="badge">express demandé</span></>}
      </p>
      <Flash ok={ok} err={err} />
      <div className="btn-row" style={{ marginBottom: 16 }}>
        <a className="btn small" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>Appeler le donneur d&apos;ordre</a>
        <a className="btn small secondary" href={`tel:${d.recipientPhone.replace(/[^\d+]/g, "")}`}>Appeler le réceptionnaire</a>
        <a className="btn small secondary" href={`mailto:${c.email}?subject=${encodeURIComponent(`Votre demande ${r.reference}`)}`}>Envoyer un email</a>
      </div>

      <div className="detail-grid">
        <div>
          <div className="grid-2">
            <section className="box" aria-labelledby="h-client">
              <h2 id="h-client">Donneur d&apos;ordre</h2>
              <dl className="kv">
                <dt>Type</dt><dd>{CLIENT_KIND_LABEL[c.kind]}</dd>
                {pro && <><dt>Raison sociale</dt><dd>{c.companyName}</dd><dt>SIRET</dt><dd>{c.siret ?? "—"}</dd></>}
                <dt>Contact</dt><dd>{c.contactName}</dd>
                <dt>Téléphone</dt><dd><a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a></dd>
                <dt>Email</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd>
                <dt>Adresse client</dt><dd>{c.billingLine1 ? `${c.billingLine1}${c.billingLine2 ? ", " + c.billingLine2 : ""}, ${c.billingPostalCode} ${c.billingCity}` : "—"}</dd>
                <dt>Réf. client</dt><dd>{r.customerReference ?? "—"}</dd>
              </dl>
            </section>
            <section className="box" aria-labelledby="h-site">
              <h2 id="h-site">Lieu de livraison &amp; réceptionnaire</h2>
              <dl className="kv">
                <dt>Réceptionnaire</dt><dd>{d.recipientName}</dd>
                <dt>Téléphone</dt><dd><a href={`tel:${d.recipientPhone.replace(/[^\d+]/g, "")}`}>{d.recipientPhone}</a></dd>
                <dt>Adresse</dt><dd>{d.line1}{d.line2 ? `, ${d.line2}` : ""}, {d.postalCode} {d.city}</dd>
                <dt>Lieu</dt><dd>{PLACE_LABEL[d.placeType as keyof typeof PLACE_LABEL] ?? d.placeType}</dd>
                <dt>Étage / ascenseur</dt><dd>{d.floor ?? "—"} · {d.elevator ?? "—"}</dd>
                <dt>Stationnement</dt><dd>{d.parking ?? "—"}</dd>
                <dt>Accès</dt><dd>{d.accessInstructions ?? "—"}</dd>
                <dt>Horaires souhaités</dt><dd>{d.preferredHours ?? "—"}</dd>
                {r.multiSite && <><dt>Multi-sites</dt><dd>{r.siteCount} logements/sites — {r.multiSiteDetails ?? ""}</dd></>}
              </dl>
            </section>
          </div>

          <section className="box">
            <h2>Besoin et estimation (figée à la demande)</h2>
            <dl className="kv">
              <dt>Surface / pièces</dt><dd>{r.surfaceM2} m² · {r.rooms} pièce(s){need.heating?.surfaceMode === "detail" ? ` (détail : ${need.heating.roomSurfaces?.join(" + ")} m²)` : ""}</dd>
              <dt>Hauteur / isolation</dt><dd>{r.ceilingHeightM} m · {r.insulation}</dd>
              {r.service === "chauffage" && <><dt>Quantité</dt><dd><strong>{r.quantityRequested}</strong> souhaitée(s) · {r.quantityRecommended} recommandée(s) · {(r.estimatedPowerW ?? 0) / 1000} kW</dd></>}
              {snap.cooling && <><dt>Puissance froid</dt><dd>{snap.cooling.lowW / 1000}–{snap.cooling.highW / 1000} kW ({snap.cooling.lowBtu}–{snap.cooling.highBtu} BTU/h) · exposition {String(need.cooling?.exposure)} · évacuation {String(need.cooling?.exhaust)} · bruit {need.cooling?.noiseSensitive ? "oui" : "non"} · prise {String(need.cooling?.power)}</dd></>}
              <dt>Début souhaité</dt><dd>{formatIsoDate(r.desiredStartDate)} · {r.durationUnknown ? "durée inconnue" : `${r.estimatedDays} j estimés`}{r.plannedReturnDate ? ` · reprise prévue ${formatIsoDate(r.plannedReturnDate)}` : ""}</dd>
              <dt>Notes client</dt><dd>{r.notes ?? "—"}</dd>
            </dl>
            {snap.heating && snap.heating.warnings.length > 0 && <div className="notice warn" style={{ marginTop: 10 }}><ul>{snap.heating.warnings.map((w) => <li key={w}>{HEATING_WARNING_TEXT[w]}</li>)}</ul></div>}
            <div style={{ marginTop: 10 }}>
              {snap.price.mode === "estimate" ? (
                <table className="data"><tbody>
                  {snap.price.lines.map((l) => <tr key={l.code}><td>{l.label}</td><td>{l.quantity} × {formatEuros(l.unitHtCents)}</td><td>{formatEuros(l.totalHtCents)} HT</td></tr>)}
                  <tr><td colSpan={2}><strong>Total estimé</strong></td><td><strong>{formatEuros(snap.price.totalHtCents)} HT</strong> · {formatEuros(snap.price.totalTtcCents)} TTC</td></tr>
                  {snap.price.expressOptionHtCents != null && <tr><td colSpan={3}>Express demandé : +{formatEuros(snap.price.expressOptionHtCents)} HT si confirmé (non inclus)</td></tr>}
                </tbody></table>
              ) : (
                <div className="notice info"><p><strong>Sur devis</strong></p><ul>{snap.price.reasons.map((x) => <li key={x}>{QUOTE_REASON_TEXT[x]}</li>)}</ul></div>
              )}
            </div>
          </section>

          <section className="box">
            <h2>Devis (versions figées)</h2>
            {det.quotes.length > 0 ? (
              <table className="data"><thead><tr><th>Version</th><th>Lignes</th><th>Total</th><th>Date</th></tr></thead><tbody>
                {det.quotes.map((q) => (
                  <tr key={q.id}><td>v{q.version}</td><td>{(q.lines as { label: string; quantity: number; unitHtCents: number }[]).map((l) => `${l.label} : ${l.quantity} × ${formatEuros(l.unitHtCents)}`).join(" · ")}</td><td>{formatEuros(q.totalHtCents)} HT · {formatEuros(q.totalTtcCents)} TTC</td><td>{formatDateTime(q.createdAt)}</td></tr>
                ))}
              </tbody></table>
            ) : <p className="small muted">Aucun devis. Un devis est requis avant confirmation. Le devis ferme est transmis hors site (email/PDF commercial).</p>}
            {(user.role === "admin" || user.role === "commercial") && !["cloturee", "annulee"].includes(r.status) && (
              <details style={{ marginTop: 10 }}>
                <summary><strong>Créer une nouvelle version de devis</strong></summary>
                <form action={quoteAction} style={{ marginTop: 10 }}>
                  <input type="hidden" name="id" value={r.id} />
                  {Array.from({ length: 5 }, (_, i) => {
                    const l = prefill[i];
                    return (
                      <div className="inline-form" key={i} style={{ marginBottom: 6 }}>
                        <label className="field" style={{ flex: 3 }}><span className="label small">Libellé</span><input type="text" name={`label_${i}`} defaultValue={l?.label ?? ""} /></label>
                        <label className="field" style={{ width: 80 }}><span className="label small">Qté</span><input type="number" name={`qty_${i}`} min={1} defaultValue={l?.quantity ?? 1} /></label>
                        <label className="field" style={{ width: 120 }}><span className="label small">PU HT (€)</span><input type="text" inputMode="decimal" name={`unit_${i}`} defaultValue={l ? (l.unitHtCents / 100).toFixed(2) : ""} /></label>
                      </div>
                    );
                  })}
                  <label className="field"><span className="label small">Note</span><input type="text" name="note" /></label>
                  <p className="tiny muted">Avant toute remise : vérifier marge, zone, taille de commande et coût de transport réel.</p>
                  <button className="btn small">Enregistrer le devis</button>
                </form>
              </details>
            )}
          </section>

          <section className="box">
            <h2>Planning, matériel et exploitation</h2>
            <form action={planningAction}>
              <input type="hidden" name="id" value={r.id} />
              <div className="row-3">
                <label className="field"><span className="label small">Livraison confirmée — date</span><input type="date" name="deliveryDate" defaultValue={dl.date} /></label>
                <label className="field"><span className="label small">Heure</span><input type="text" name="deliveryTime" placeholder="09:00" defaultValue={dl.time} /></label>
                <label className="field"><span className="label small">Créneau annoncé</span><input type="text" name="deliverySlot" placeholder="9h–11h" defaultValue={r.confirmedDeliverySlot ?? ""} /></label>
              </div>
              <div className="row-3">
                <label className="field"><span className="label small">Reprise prévue — date</span><input type="date" name="pickupDate" defaultValue={pk.date} /></label>
                <label className="field"><span className="label small">Heure</span><input type="text" name="pickupTime" placeholder="10:00" defaultValue={pk.time} /></label>
                <label className="field"><span className="label small">Prochaine relance</span><input type="date" name="nextActionDate" defaultValue={parisParts(r.nextActionAt).date} /></label>
              </div>
              <label className="field"><span className="label small">Quantité confirmée (souhaitée par le client : {r.quantityRequested ?? "—"})</span><input type="number" name="quantityConfirmed" min={1} defaultValue={r.quantityConfirmed ?? r.quantityRequested ?? ""} /></label>
              <label className="field"><span className="label small">Modèle de matériel retenu</span>
                <select name="equipmentModelId" defaultValue={r.equipmentModelId ?? ""}><option value="">— à choisir —</option>{models.map((m) => <option key={m.id} value={m.id}>{m.brand} {m.model}{m.manufacturerRef ? ` (${m.manufacturerRef})` : ""}{m.referenceVerified ? "" : " — réf. non vérifiée"}</option>)}</select></label>
              <label className="field"><span className="label small">Note technique et électrique</span><textarea name="technicalNote" defaultValue={r.technicalNote ?? ""} placeholder="Tableau électrique, circuits, nombre de prises par pièce, vérification par une personne compétente…" /></label>
              <details><summary className="small"><strong>Coûts réels (rentabilité — phase 2)</strong></summary>
                <div className="row-3" style={{ marginTop: 8 }}>
                  <label className="field"><span className="label small">Coût logistique réel (€)</span><input type="text" name="logisticsCost" defaultValue={r.logisticsCostCents != null ? (r.logisticsCostCents / 100).toFixed(2) : ""} /></label>
                  <label className="field"><span className="label small">Manutention (min)</span><input type="number" name="handlingMinutes" defaultValue={r.handlingMinutes ?? ""} /></label>
                  <label className="field"><span className="label small">Distance (km)</span><input type="text" name="distanceKm" defaultValue={r.distanceKm ?? ""} /></label>
                </div>
                <div className="row-2">
                  <label className="field"><span className="label small">Coût incident (€)</span><input type="text" name="incidentCost" defaultValue={r.incidentCostCents != null ? (r.incidentCostCents / 100).toFixed(2) : ""} /></label>
                  <label className="field"><span className="label small">Incident / casse / retard</span><input type="text" name="incidentNote" defaultValue={r.incidentNote ?? ""} /></label>
                </div>
              </details>
              <button className="btn small">Enregistrer</button>
            </form>
          </section>

          <section className="box" id="affectation">
            <h2>Affectation des appareils</h2>
            <p className="small">Quantité confirmée : <strong>{expected ?? "—"}</strong> · affectés (non remis) : <strong>{reserved.length}</strong> · <strong>remis</strong> au total : <strong>{delivered.length}</strong> · chez le client : <strong>{atClient.length}</strong> · repris : <strong>{returnedCount}</strong>. Un appareil reste indisponible pour toute autre demande <strong>jusqu&apos;à sa reprise constatée</strong>, quelle que soit la date de reprise prévue.</p>
            {det.allocs.length > 0 ? (
              <div className="table-wrap"><table className="data"><thead><tr><th>Réf. interne</th><th>Modèle</th><th>N° série / lot</th><th>Statut</th><th>Remise réelle</th><th>Reprise réelle</th><th>Reprise prévue</th><th></th></tr></thead><tbody>
                {det.allocs.map(({ a, u, m }) => (
                  <tr key={a.id}>
                    <td><strong>{u.inventoryCode}</strong></td><td>{m.brand} {m.model}</td><td className="small">{u.serialNumber ?? "—"} / {u.lotNumber ?? "—"}</td>
                    <td><span className={`badge ${a.status === "remise" ? "s-livree" : a.status === "reservee" ? "s-confirmee" : ""}`}>{{ reservee: "réservé", remise: "chez le client", retournee: `repris (${a.returnCondition})`, annulee: "annulé" }[a.status]}</span>
                      {a.status === "remise" && a.endAt && a.endAt < new Date() && <> <span className="badge danger">reprise en retard</span></>}</td>
                    <td>{formatDateTime(a.deliveredAt)}</td><td>{formatDateTime(a.returnedAt)}</td><td>{a.endAt ? formatDateTime(a.endAt) : "—"}</td>
                    <td>{a.status === "reservee" && user.role === "admin" && (
                      <details><summary className="small">Annuler la réservation</summary>
                        <form action={cancelReservationAction} className="inline-form"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="allocationId" value={a.id} /><label className="field"><span className="label small">Motif (tracé)</span><input type="text" name="reason" required minLength={5} /></label><button className="btn small ghost">Annuler</button></form>
                      </details>)}{a.status === "annulee" && <span className="tiny muted">{a.cancelReason}</span>}</td>
                  </tr>
                ))}
              </tbody></table></div>
            ) : <p className="small muted">Aucun appareil affecté.</p>}
            {canAllocate && openAllocs.length < (expected ?? 0) ? (
              <form action={allocateAction} style={{ marginTop: 10 }}>
                <input type="hidden" name="id" value={r.id} />
                <p className="small">{free.length} appareil(s) louable(s) et libre(s) (état neuf/bon, aucune affectation ouverte). Reste à affecter : {(expected ?? 0) - openAllocs.length}.</p>
                <div className="options" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                  {free.map((u) => <label key={u.id} className="option"><input type="checkbox" name="unit" value={u.id} /><span>{u.inventory_code}<small>{u.brand} {u.model} · {u.condition}{u.model_id !== r.equipmentModelId ? " · autre modèle" : ""}</small></span></label>)}
                </div>
                <label className="field" style={{ marginTop: 8 }}><span className="label small">Lot mixte (autre modèle / puissance) : justification</span><input type="text" name="mixedJustification" placeholder="Uniquement si un appareil d'un autre modèle est sélectionné" /></label>
                <button className="btn small" disabled={free.length === 0}>Affecter la sélection</button>
              </form>
            ) : !canAllocate && ["confirmee", "preparation"].includes(r.status) ? <p className="tiny muted">Pour affecter : demande confirmée, date de livraison, modèle retenu et quantité confirmée renseignés (Planning).</p> : null}
          </section>

          <section className="box">
            <h2>Bon de remise et de reprise (PDF A4)</h2>
            {BON_ALLOWED_STATUSES.includes(r.status) && openAllocs.length > 0 ? (
              <form action={bonAction}>
                <input type="hidden" name="id" value={r.id} />
                {expected != null && openAllocs.length !== expected && openAllocs.length > 0 && (
                  <label className="field"><span className="label small">Écart : {openAllocs.length} affecté(s) pour {expected} confirmé(s) — justification obligatoire (imprimée sur le bon)</span><input type="text" name="quantityJustification" /></label>
                )}
                <button className="btn">Générer le bon de remise / reprise</button>
              </form>
            ) : <p className="small muted">{openAllocs.length === 0 && BON_ALLOWED_STATUSES.includes(r.status) ? "Aucun appareil affecté ou en cours de location : pas de nouveau bon à générer." : "Disponible après confirmation de la demande et affectation des appareils."}</p>}
            {det.docs.length > 0 && (
              <ul className="timeline" style={{ marginTop: 10 }}>
                {det.docs.map((doc) => <li key={doc.id}><a href={`/api/admin/documents/${doc.id}`} target="_blank" rel="noopener">{doc.number} — version {doc.version} ({Math.round(doc.size / 1024)} Ko)</a> · généré le {formatDateTime(doc.generatedAt)} · <span className="tiny muted">SHA-256 {doc.sha256.slice(0, 12)}…</span></li>)}
              </ul>
            )}
          </section>

          {canDeliver && (
            <section className="box" id="constat-remise">
              <h2>Constat de remise (faits réels, d&apos;après le bon signé)</h2>
              <form action={deliveryAction} encType="multipart/form-data">
                <input type="hidden" name="id" value={r.id} />
                <div className="row-3">
                  <label className="field"><span className="label small">Date réelle de remise</span><input type="date" name="date" required max={nowParis.date} /></label>
                  <label className="field"><span className="label small">Heure réelle (Paris)</span><input type="time" name="time" required /></label>
                  <label className="field"><span className="label small">Personne qui a remis le matériel</span><input type="text" name="agentName" required /></label>
                </div>
                <label className="field"><span className="label small">Réceptionnaire présent (nom)</span><input type="text" name="recipientName" required defaultValue={d.recipientName} /></label>
                <fieldset><legend className="small">Appareils effectivement remis</legend>
                  <div className="options" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                    {reserved.map(({ a, u }) => <label key={a.id} className="option"><input type="checkbox" name="allocation" value={a.id} defaultChecked /><span>{u.inventoryCode}</span></label>)}
                  </div>
                </fieldset>
                <label className="field"><span className="label small">Si la quantité totale remise diffère de la quantité confirmée ({expected ?? "—"}) : justification</span><input type="text" name="quantityJustification" /></label>
                <fieldset><legend className="small">Notice complète du constructeur remise — par modèle</legend>
                  {reservedModels.map((m) => (
                    <div key={m.id} className="inline-form" style={{ marginBottom: 6 }}>
                      <input type="hidden" name="noticeModel" value={m.id} />
                      <span className="small" style={{ minWidth: 220 }}>{m.brand} {m.model}{m.manufacturerRef ? ` (${m.manufacturerRef})` : ""}{m.noticeVersion ? ` — ${m.noticeVersion}` : ""}</span>
                      <label className="check small" style={{ margin: 0 }}><input type="radio" name={`notice_${m.id}`} value="oui" required aria-label={`Notice ${m.model} remise`} /><span>remise</span></label>
                      <label className="check small" style={{ margin: 0 }}><input type="radio" name={`notice_${m.id}`} value="non" aria-label={`Notice ${m.model} NON remise`} /><span>NON remise</span></label>
                    </div>
                  ))}
                </fieldset>
                <fieldset><legend className="small">Signature du bon</legend>
                  <div className="options">
                    {(["signe", "refus", "non_recueilli"] as Signature[]).map((v) => <label key={v} className="option"><input type="radio" name="signature" value={v} required /><span>{SIGNATURE_LABEL[v]}</span></label>)}
                  </div>
                </fieldset>
                <label className="field"><span className="label small">État visuel / réserves</span><textarea name="reserves" /></label>
                <details className="notice warn" style={{ margin: "10px 0" }}>
                  <summary><strong>Incident — obligatoire si notice non remise, refus ou absence de signature</strong></summary>
                  <p className="tiny">Procédure terrain : en cas de refus de signer, la personne qui remet inscrit sur le bon « Refus de signer », la date, l&apos;heure, son nom et signe ; si possible un témoin signe aussi. Ne jamais laisser un appareil sans sa notice : la remettre au plus tôt et le consigner ici.</p>
                  <label className="field"><span className="label small">Que s&apos;est-il passé ? (qui, pourquoi)</span><textarea name="incidentDescription" /></label>
                  <label className="field"><span className="label small">Consignes de résolution (ex. renvoi de la notice, rappel du donneur d&apos;ordre)</span><textarea name="incidentInstructions" /></label>
                </details>
                <label className="field"><span className="label small">Scan ou photo du bon signé (PDF, JPEG, PNG — 2,5 Mo max.){encrypted ? " — stocké chiffré" : ""}</span><input type="file" name="signedScan" accept="application/pdf,image/jpeg,image/png,image/webp" /></label>
                <label className="field"><span className="label small">Photos facultatives (JPEG/PNG/WebP, {PHOTO_MAX_COUNT} max., 1,2 Mo chacune)</span><input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple /></label>
                <p className="tiny muted">« Remise conforme » uniquement si le bon est signé ET toutes les notices remises. Sinon un incident est ouvert et reste visible jusqu&apos;à sa résolution. Le bon prouve la remise ; il n&apos;exonère pas le loueur de ses responsabilités.</p>
                <button className="btn small">Enregistrer le constat de remise</button>
              </form>
            </section>
          )}

          {atClient.length > 0 && (
            <section className="box" id="constat-reprise">
              <h2>Constat de reprise (totale ou partielle)</h2>
              <form action={returnAction} encType="multipart/form-data">
                <input type="hidden" name="id" value={r.id} />
                <div className="row-3">
                  <label className="field"><span className="label small">Date réelle de reprise</span><input type="date" name="date" required max={nowParis.date} /></label>
                  <label className="field"><span className="label small">Heure réelle (Paris)</span><input type="time" name="time" required /></label>
                  <label className="field"><span className="label small">Personne qui a repris le matériel</span><input type="text" name="agentName" required /></label>
                </div>
                <label className="field"><span className="label small">Réceptionnaire présent (nom)</span><input type="text" name="recipientName" required defaultValue={d.recipientName} /></label>
                <div className="table-wrap"><table className="data"><thead><tr><th>Récupéré</th><th>Appareil</th><th>État apparent</th><th>Observation</th></tr></thead><tbody>
                  {atClient.map(({ a, u }) => (
                    <tr key={a.id}>
                      <td><input type="checkbox" name="allocation" value={a.id} aria-label={`${u.inventoryCode} récupéré`} /></td>
                      <td><strong>{u.inventoryCode}</strong><br /><span className="tiny muted">remis le {formatDateTime(a.deliveredAt)}</span></td>
                      <td><select name={`condition_${a.id}`} aria-label={`État de ${u.inventoryCode}`} defaultValue="conforme"><option value="conforme">conforme</option><option value="degrade">dégradé</option><option value="incomplet">incomplet</option><option value="hors_service">hors service</option></select></td>
                      <td><input type="text" name={`note_${a.id}`} aria-label={`Observation ${u.inventoryCode}`} /></td>
                    </tr>
                  ))}
                </tbody></table></div>
                <div className="row-2" style={{ marginTop: 8 }}>
                  <label className="field"><span className="label small">État général</span><select name="generalCondition"><option value="conforme">conforme</option><option value="degrade">dégradé</option><option value="incomplet">incomplet</option></select></label>
                  <label className="field"><span className="label small">Observations et réserves</span><input type="text" name="reserves" /></label>
                </div>
                <fieldset><legend className="small">Signature du bon</legend>
                  <div className="options">
                    {(["signe", "refus", "non_recueilli"] as Signature[]).map((v) => <label key={v} className="option"><input type="radio" name="signature" value={v} required /><span>{SIGNATURE_LABEL[v]}</span></label>)}
                  </div>
                </fieldset>
                <details className="notice warn" style={{ margin: "10px 0" }}>
                  <summary><strong>Incident — obligatoire si notice non remise, refus ou absence de signature</strong></summary>
                  <p className="tiny">Procédure terrain : en cas de refus de signer, la personne qui remet inscrit sur le bon « Refus de signer », la date, l&apos;heure, son nom et signe ; si possible un témoin signe aussi. Ne jamais laisser un appareil sans sa notice : la remettre au plus tôt et le consigner ici.</p>
                  <label className="field"><span className="label small">Que s&apos;est-il passé ? (qui, pourquoi)</span><textarea name="incidentDescription" /></label>
                  <label className="field"><span className="label small">Consignes de résolution (ex. renvoi de la notice, rappel du donneur d&apos;ordre)</span><textarea name="incidentInstructions" /></label>
                </details>
                <label className="field"><span className="label small">Scan ou photo du bon signé (PDF, JPEG, PNG — 2,5 Mo max.){encrypted ? " — stocké chiffré" : ""}</span><input type="file" name="signedScan" accept="application/pdf,image/jpeg,image/png,image/webp" /></label>
                <label className="field"><span className="label small">Photos facultatives</span><input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple /></label>
                <p className="tiny muted">Seuls les appareils cochés sont restitués. Tous passent « à contrôler » (hors service : retirés) et ne redeviennent louables qu&apos;après un <a href="/admin/materiel#controles">contrôle technique</a>. Les autres restent bloqués chez le client.</p>
                <button className="btn small">Enregistrer le constat de reprise</button>
              </form>
            </section>
          )}

          {det.incidents.length > 0 && (
            <section className="box" id="incidents" style={{ borderColor: openIncidents.length ? "var(--danger)" : undefined }}>
              <h2>Incidents</h2>
              <ul className="timeline">
                {det.incidents.map((inc) => (
                  <li key={inc.id}>
                    <span className={`badge ${inc.status === "ouvert" ? "danger" : ""}`}>{inc.status}</span> <strong>{INCIDENT_LABEL[inc.kind]}</strong> · {formatDateTime(inc.reportedAt)}
                    <br /><span className="small">{inc.description}</span><br /><span className="small"><strong>Consignes :</strong> {inc.resolutionInstructions}</span>
                    {inc.status === "resolu" ? <><br /><span className="small">Résolu le {formatDateTime(inc.resolvedAt)} : {inc.resolutionNote}</span></> : user.role === "admin" && (
                      <form action={resolveIncidentAction} className="inline-form" style={{ marginTop: 6 }}>
                        <input type="hidden" name="incidentId" value={inc.id} /><input type="hidden" name="return" value={`/admin/demandes/${r.id}`} />
                        <label className="field"><span className="label small">Résolution</span><input type="text" name="note" required minLength={5} /></label>
                        <button className="btn small ghost">Clôturer l&apos;incident</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {det.handovers.length > 0 && (
            <section className="box">
              <h2>Constats enregistrés</h2>
              <ul className="timeline">
                {det.handovers.map(({ h, by }) => {
                  const att = det.photos.filter((p) => p.handoverId === h.id);
                  const scans = att.filter((p) => p.kind === "bon_signe");
                  const notices = (h.notices ?? null) as Record<string, { label: string; given: boolean }> | null;
                  return (
                    <li key={h.id}>
                      <strong>{h.kind === "remise" ? "Remise" : "Reprise"}</strong> le {formatDateTime(h.occurredAt)} — {h.quantity} appareil(s) : {det.handoverItems.filter((i) => i.handoverId === h.id).map((i) => `${i.inventoryCode}${i.condition && h.kind === "reprise" ? ` (${i.condition})` : ""}`).join(", ")}
                      {" "}<span className={`badge ${h.outcome === "conforme" ? "s-confirmee" : h.outcome === "incident" ? "danger" : "warn"}`}>{h.outcome === "conforme" ? "conforme" : h.outcome === "avec_reserves" ? "avec réserves" : h.outcome === "incident" ? "incident" : "non qualifié (avant v3)"}</span>
                      <br /><span className="small">Par {h.agentName} · réceptionnaire {h.recipientName} · {h.signature ? SIGNATURE_LABEL[h.signature as Signature] : `bon papier signé : ${h.paperSigned ? "oui" : "non"}`}
                        {h.kind === "remise" ? (notices ? ` · notices : ${Object.values(notices).map((n) => `${n.label} ${n.given ? "remise" : "NON remise"}`).join(" ; ")}` : ` · notice ${h.noticeGiven ? "remise" : "NON remise"}`) : ` · état général ${h.generalCondition}`}
                        {h.quantityJustification ? ` · écart justifié : ${h.quantityJustification}` : ""}{h.reserves ? ` · réserves : ${h.reserves}` : ""}</span>
                      <br /><span className="small">Preuve : {scans.length ? scans.map((p, k) => <span key={p.id}><a href={`/api/admin/photos/${p.id}`} target="_blank" rel="noopener">scan du bon signé {k + 1}</a>{p.encryption ? " (chiffré)" : ""} </span>) : <span className="badge warn">scan du bon signé non déposé</span>}
                        {att.filter((p) => p.kind === "photo").map((p, k) => <span key={p.id}> · <a href={`/api/admin/photos/${p.id}`} target="_blank" rel="noopener">photo {k + 1}</a></span>)}</span>
                      <br /><span className="tiny muted">Saisi par {by} le {formatDateTime(h.recordedAt)}</span>
                      <form action={scanAction} encType="multipart/form-data" className="inline-form" style={{ marginTop: 4 }}>
                        <input type="hidden" name="id" value={r.id} /><input type="hidden" name="handoverId" value={h.id} />
                        <label className="field"><span className="label small">Déposer le scan du bon signé</span><input type="file" name="signedScan" accept="application/pdf,image/jpeg,image/png,image/webp" required aria-label={`Scan du bon signé — ${h.kind} du ${formatDateTime(h.occurredAt)}`} /></label>
                        <button className="btn small ghost">Déposer</button>
                      </form>
                    </li>
                  );
                })}
              </ul>
              {!encrypted && <p className="tiny muted">Chiffrement applicatif des pièces jointes inactif (FILE_ENCRYPTION_KEY non définie) : stockage protégé par l&apos;authentification et le chiffrement au repos de l&apos;hébergeur uniquement.</p>}
            </section>
          )}

          {delivered.length > 0 && (
            <section className="box">
              <h2>Durée constatée (non facturante)</h2>
              <p className="small">Règle des conditions acceptées (grille v{det.acceptedVersion}) : <strong>{dayRule ? DAY_RULE_LABEL[dayRule] : "non définie — durée facturable à déterminer selon les CGL validées"}</strong>.</p>
              <table className="data"><thead><tr><th>Appareil</th><th>Remise réelle</th><th>Reprise réelle</th><th>Jours</th></tr></thead><tbody>
                {delivered.map(({ a, u }) => {
                  const days = a.returnedAt ? rentalDays(a.deliveredAt!, a.returnedAt, dayRule) : null;
                  return <tr key={a.id}><td>{u.inventoryCode}</td><td>{formatDateTime(a.deliveredAt)}</td><td>{a.returnedAt ? formatDateTime(a.returnedAt) : "en cours"}</td><td>{a.returnedAt ? (days ?? "à déterminer") : "—"}</td></tr>;
                })}
              </tbody></table>
              <p className="tiny muted">Information d&apos;exploitation : ce tableau n&apos;est ni une facture ni un décompte contractuel.</p>
            </section>
          )}

          {det.allocEvents.length > 0 && (
            <section className="box">
              <h2>Journal immuable du matériel</h2>
              <ul className="timeline small">{det.allocEvents.map(({ e, code, actor }) => <li key={e.id}>{formatDateTime(e.occurredAt)} — <strong>{e.kind}</strong> {code ?? ""} · {actor ?? "système"}{e.details ? <span className="tiny muted"> {JSON.stringify(e.details)}</span> : null}</li>)}</ul>
            </section>
          )}
        </div>

        <div>
          <section className="box">
            <h2>Changer le statut</h2>
            {allowed.filter((s) => (s !== "confirmee" || r.status !== "devis_a_confirmer") && s !== "livree" && s !== "reprise_effective").length > 0 ? (
              <form action={statusAction}>
                <input type="hidden" name="id" value={r.id} />
                <label className="field"><span className="label small">Nouveau statut</span>
                  <select name="to" required>{allowed.filter((s) => (s !== "confirmee" || r.status !== "devis_a_confirmer") && s !== "livree" && s !== "reprise_effective").map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
                <label className="field"><span className="label small">Note (tracée ; motif obligatoire pour un refus)</span><input type="text" name="note" /></label>
                <p className="tiny muted">« Livrée » et « Reprise effectuée » sont posés par les constats (dates réelles), pas par ce menu.</p>
                <button className="btn small">Appliquer</button>
              </form>
            ) : <p className="small muted">Aucun changement possible.</p>}
            {allowed.includes("confirmee") && r.status === "devis_a_confirmer" && (
              <form action={statusAction} style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <h3>Confirmer la commande</h3>
                {user.role !== "admin" && <p className="notice warn small">Seul un administrateur peut confirmer.</p>}
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="to" value="confirmee" />
                {CONFIRMATION_CHECKS.map((ch) => <label className="check small" key={ch.key}><input type="checkbox" name={`check_${ch.key}`} /><span>{ch.label}</span></label>)}
                {r.isErp && <label className="check small"><input type="checkbox" name={`check_${ERP_CHECK.key}`} /><span>{ERP_CHECK.label}</span></label>}
                <p className="tiny muted">Pré-requis : un devis enregistré ({det.quotes.length > 0 ? "✓" : "✗"}) et une date de livraison confirmée ({r.confirmedDeliveryAt ? "✓" : "✗"}).</p>
                <label className="field"><span className="label small">Note</span><input type="text" name="note" /></label>
                <button className="btn small" disabled={user.role !== "admin"}>Confirmer après contrôle</button>
              </form>
            )}
          </section>

          <section className="box">
            <h2>Appels et notes internes</h2>
            <form action={activityAction}>
              <input type="hidden" name="id" value={r.id} />
              <label className="field"><span className="label small">Type</span><select name="kind"><option value="appel">Appel</option><option value="note">Note interne</option><option value="email">Email envoyé</option></select></label>
              <label className="field"><span className="label small">Contenu</span><textarea name="body" required /></label>
              <button className="btn small">Ajouter</button>
            </form>
            <ul className="timeline" style={{ marginTop: 10 }}>
              {det.acts.map(({ a, author }) => <li key={a.id}><strong>{a.kind}</strong> · {formatDateTime(a.createdAt)} · {author}<br />{a.body}</li>)}
            </ul>
          </section>

          <section className="box">
            <h2>Historique des statuts</h2>
            <ul className="timeline">
              {det.events.map(({ e, actor }) => <li key={e.id}>{formatDateTime(e.createdAt)} — {e.fromStatus ? `${STATUS_LABEL[e.fromStatus]} → ` : ""}<strong>{STATUS_LABEL[e.toStatus]}</strong> · {actor ?? "système"}{e.note ? ` — ${e.note}` : ""}</li>)}
            </ul>
          </section>

          <section className="box">
            <h2>Notifications</h2>
            <ul className="timeline">
              {det.notifs.map((n) => (
                <li key={n.id}>{n.kind === "client_ack" ? "Accusé client" : "Alerte équipe"} : <span className={`badge ${n.status === "sent" ? "" : "danger"}`}>{n.status}</span> · {n.attempts} tentative(s){n.sentAt ? ` · envoyé ${formatDateTime(n.sentAt)}` : ""}{n.lastError ? <><br /><span className="tiny muted">{n.lastError}</span></> : null}
                  {(n.status === "failed" || n.status === "dead") && <form action={retryNotificationsAction}><input type="hidden" name="notificationId" value={n.id} /><input type="hidden" name="return" value={`/admin/demandes/${r.id}`} /><button className="btn small ghost">Renvoyer</button></form>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
