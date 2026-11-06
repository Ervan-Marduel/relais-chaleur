"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { sql, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { adminUsers, equipmentModels, equipmentUnits } from "@/db/schema";
import { REQUEST_STATUSES, type RequestStatus } from "@/lib/domain/status";
import { parisLocalToUtc } from "@/lib/format";
import { createAdminUser, destroySession, login, requireUser, setSessionCookie } from "@/server/auth";
import { resetUserPassword, setUserActive } from "@/server/passwords";
import { addActivity, allocateUnits, attachSignedBon, cancelReservation, changeStatus, createQuote, INSPECTION_CHECKS, recordDelivery, recordInspection, recordReturn, resolveIncident, savePlanning, PHOTO_MAX_COUNT, type PhotoInput, type ReturnItemInput, type Signature } from "@/server/request-ops";
import { generateBon } from "@/server/documents";
import { processDueNotifications, requeueNotification } from "@/server/notifications";
import { publishSettingsVersion, invalidateSettingsCache } from "@/server/settings-store";
import { audit } from "@/server/admin-data";
import { clientIp, hashIp, safeEqual } from "@/server/security";
import { env } from "@/server/env";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (id: string, r: { ok: boolean; message?: string; error?: string }) =>
  redirect(`/admin/demandes/${id}?${r.ok ? "ok" : "err"}=${encodeURIComponent((r.ok ? r.message : r.error) ?? "")}`);
const uuid = (s: string) => (/^[0-9a-f-]{36}$/i.test(s) ? s : (() => { throw new Error("Identifiant invalide"); })());

export async function loginAction(_: unknown, f: FormData) {
  const h = await headers();
  const res = await login(getDb(), str(f, "email"), String(f.get("password") ?? ""), hashIp(clientIp(h)));
  if (!res.ok) {
    return { error: res.reason === "locked" ? "Compte temporairement verrouillé (trop d'essais). Réessayez dans 15 minutes." : res.reason === "rate_limited" ? "Trop de tentatives. Patientez quelques minutes." : "Identifiants incorrects." };
  }
  await setSessionCookie(res.token);
  redirect("/admin");
}

export async function logoutAction() {
  await destroySession();
  redirect("/admin/login");
}

/** Création du PREMIER administrateur, possible uniquement si aucun compte n'existe et avec ADMIN_SETUP_TOKEN. */
export async function setupAction(_: unknown, f: FormData) {
  const token = env().ADMIN_SETUP_TOKEN;
  if (!token || token.length < 12) return { error: "ADMIN_SETUP_TOKEN absent ou trop court dans la configuration." };
  if (!safeEqual(str(f, "token"), token)) return { error: "Jeton d'installation incorrect." };
  const db = getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(adminUsers);
  if (Number(n) > 0) return { error: "Un administrateur existe déjà. Cette page est désactivée." };
  const pw = String(f.get("password") ?? "");
  if (pw.length < 12) return { error: "Mot de passe : 12 caractères minimum." };
  if (pw !== String(f.get("password2") ?? "")) return { error: "Les mots de passe ne correspondent pas." };
  const email = str(f, "email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Email invalide." };
  const u = await createAdminUser(db, { email, name: str(f, "name") || email, password: pw, role: "admin" });
  await audit(db, u.id, "admin.setup");
  redirect("/admin/login?ok=Compte+créé,+connectez-vous");
}

export async function statusAction(f: FormData) {
  const u = await requireUser();
  const id = uuid(str(f, "id"));
  const to = str(f, "to") as RequestStatus;
  if (!(REQUEST_STATUSES as readonly string[]).includes(to)) back(id, { ok: false, error: "Statut inconnu." });
  const checks: Record<string, boolean> = {};
  for (const k of ["stock", "zone", "electricite", "devis", "creneau", "erp"]) checks[k] = f.get(`check_${k}`) === "on";
  const r = await changeStatus(getDb(), { id: u.id, role: u.role }, id, to, str(f, "note").slice(0, 2000), checks);
  revalidatePath(`/admin/demandes/${id}`);
  back(id, r);
}

export async function activityAction(f: FormData) {
  const u = await requireUser();
  const id = uuid(str(f, "id"));
  const kind = (["note", "appel", "email"].includes(str(f, "kind")) ? str(f, "kind") : "note") as "note" | "appel" | "email";
  back(id, await addActivity(getDb(), { id: u.id, role: u.role }, id, kind, str(f, "body")));
}

const intOrNull = (s: string) => (s === "" ? null : Number.isFinite(Number(s.replace(",", "."))) ? Math.round(Number(s.replace(",", "."))) : null);
const eurosToCents = (s: string) => (s === "" ? null : Number.isFinite(Number(s.replace(",", "."))) ? Math.round(Number(s.replace(",", ".")) * 100) : null);

export async function planningAction(f: FormData) {
  const u = await requireUser();
  const id = uuid(str(f, "id"));
  const dt = (d: string, t: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? parisLocalToUtc(d, /^\d{2}:\d{2}$/.test(t) ? t : "08:00") : null);
  const model = str(f, "equipmentModelId");
  const qc = str(f, "quantityConfirmed");
  const r = await savePlanning(getDb(), { id: u.id, role: u.role }, id, {
    quantityConfirmed: qc === "" ? null : Number(qc),
    confirmedDeliveryAt: dt(str(f, "deliveryDate"), str(f, "deliveryTime")),
    confirmedDeliverySlot: str(f, "deliverySlot").slice(0, 120) || null,
    plannedPickupAt: dt(str(f, "pickupDate"), str(f, "pickupTime")),
    equipmentModelId: /^[0-9a-f-]{36}$/i.test(model) ? model : null,
    technicalNote: str(f, "technicalNote").slice(0, 4000) || null,
    nextActionAt: dt(str(f, "nextActionDate"), "09:00"),
    logisticsCostCents: eurosToCents(str(f, "logisticsCost")),
    handlingMinutes: intOrNull(str(f, "handlingMinutes")),
    distanceKm: str(f, "distanceKm") ? Number(str(f, "distanceKm").replace(",", ".")) || null : null,
    incidentCostCents: eurosToCents(str(f, "incidentCost")),
    incidentNote: str(f, "incidentNote").slice(0, 2000) || null,
  });
  back(id, r);
}

export async function quoteAction(f: FormData) {
  const u = await requireUser(["admin", "commercial"]);
  const id = uuid(str(f, "id"));
  const lines = [];
  for (let i = 0; i < 8; i++) {
    const label = str(f, `label_${i}`);
    if (!label) continue;
    lines.push({ label, quantity: Number(str(f, `qty_${i}`)), unitHtCents: eurosToCents(str(f, `unit_${i}`)) ?? -1 });
  }
  back(id, await createQuote(getDb(), { id: u.id, role: u.role }, id, lines, str(f, "note")));
}

export async function allocateAction(f: FormData) {
  const u = await requireUser(["admin", "preparateur", "exploitant"]);
  const id = uuid(str(f, "id"));
  const units = f.getAll("unit").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  back(id, await allocateUnits(getDb(), { id: u.id, role: u.role }, id, units, { mixedJustification: str(f, "mixedJustification") }));
}

export async function cancelReservationAction(f: FormData) {
  const u = await requireUser(["admin"]);
  const id = uuid(str(f, "id"));
  back(id, await cancelReservation(getDb(), { id: u.id, role: u.role }, uuid(str(f, "allocationId")), str(f, "reason")));
}

export async function bonAction(f: FormData) {
  const u = await requireUser(["admin", "preparateur", "exploitant"]);
  const id = uuid(str(f, "id"));
  const r = await generateBon(getDb(), id, u.id, str(f, "quantityJustification"));
  back(id, r.ok ? { ok: true, message: `Bon ${r.number} v${r.version} généré et archivé.` } : r);
}

async function readScan(f: FormData, name = "signedScan"): Promise<PhotoInput | null> {
  const x = f.get(name);
  if (!x || typeof x !== "object" || !("arrayBuffer" in x) || (x as File).size === 0) return null;
  const file = x as File;
  return { contentType: file.type, bytes: Buffer.from(await file.arrayBuffer()) };
}
const signatureOf = (f: FormData): Signature => (["signe", "refus", "non_recueilli"].includes(str(f, "signature")) ? str(f, "signature") : "") as Signature;

async function readPhotos(f: FormData): Promise<PhotoInput[]> {
  const files = f.getAll("photos").filter((x): x is File => typeof x === "object" && x !== null && "arrayBuffer" in x && (x as File).size > 0);
  return Promise.all(files.slice(0, PHOTO_MAX_COUNT + 1).map(async (file) => ({ contentType: file.type, bytes: Buffer.from(await file.arrayBuffer()) })));
}
const realDate = (f: FormData) => {
  const d = str(f, "date"), t = str(f, "time");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null;
  return parisLocalToUtc(d, t);
};

export async function deliveryAction(f: FormData) {
  const u = await requireUser(["admin", "preparateur", "exploitant"]);
  const id = uuid(str(f, "id"));
  const at = realDate(f);
  if (!at) back(id, { ok: false, error: "Date et heure réelles de remise obligatoires." });
  back(id, await recordDelivery(getDb(), { id: u.id, role: u.role }, id, {
    occurredAt: at!, agentName: str(f, "agentName"), recipientName: str(f, "recipientName"),
    allocationIds: f.getAll("allocation").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
    notices: Object.fromEntries(f.getAll("noticeModel").map(String).filter((m) => /^[0-9a-f-]{36}$/i.test(m)).map((m) => [m, str(f, `notice_${m}`) === "oui" ? true : str(f, `notice_${m}`) === "non" ? false : (undefined as unknown as boolean)])),
    signature: signatureOf(f), reserves: str(f, "reserves"), quantityJustification: str(f, "quantityJustification"),
    incidentDescription: str(f, "incidentDescription"), incidentInstructions: str(f, "incidentInstructions"),
    photos: await readPhotos(f), signedScan: await readScan(f),
  }));
}

export async function returnAction(f: FormData) {
  const u = await requireUser(["admin", "preparateur", "exploitant"]);
  const id = uuid(str(f, "id"));
  const at = realDate(f);
  if (!at) back(id, { ok: false, error: "Date et heure réelles de reprise obligatoires." });
  const items: ReturnItemInput[] = f.getAll("allocation").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).map((a) => {
    const c = str(f, `condition_${a}`);
    return { allocationId: a, condition: (["conforme", "degrade", "incomplet", "hors_service"].includes(c) ? c : "conforme") as ReturnItemInput["condition"], note: str(f, `note_${a}`) };
  });
  const gc = str(f, "generalCondition");
  back(id, await recordReturn(getDb(), { id: u.id, role: u.role }, id, {
    occurredAt: at!, agentName: str(f, "agentName"), recipientName: str(f, "recipientName"), items,
    generalCondition: (["conforme", "degrade", "incomplet"].includes(gc) ? gc : "conforme") as "conforme",
    reserves: str(f, "reserves"), signature: signatureOf(f),
    incidentDescription: str(f, "incidentDescription"), incidentInstructions: str(f, "incidentInstructions"),
    photos: await readPhotos(f), signedScan: await readScan(f),
  }));
}

export async function retryNotificationsAction(f: FormData) {
  const u = await requireUser();
  const db = getDb();
  const nid = str(f, "notificationId");
  if (nid) await requeueNotification(db, uuid(nid));
  await processDueNotifications(db, { limit: 50 });
  await audit(db, u.id, "notifications.retry");
  const ret = str(f, "return");
  redirect(ret.startsWith("/admin") ? ret : "/admin/notifications");
}

export async function settingsAction(_: unknown, f: FormData) {
  const u = await requireUser(["admin"]);
  let payload: unknown;
  try {
    payload = JSON.parse(String(f.get("payload") ?? ""));
  } catch {
    return { error: "JSON invalide." };
  }
  try {
    const row = await publishSettingsVersion(getDb(), payload, u.id, str(f, "note").slice(0, 300) || "Modification back-office");
    invalidateSettingsCache();
    await audit(getDb(), u.id, "settings.publish", "pricing_version", row.id, { version: row.version });
    revalidatePath("/", "layout");
    return { ok: `Version ${row.version} publiée et active. Les demandes existantes conservent leur prix figé.` };
  } catch (e) {
    const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
    return { error: issues ? issues.slice(0, 6).map((i) => `${i.path.join(".")} : ${i.message}`).join(" · ") : (e as Error).message };
  }
}

export async function modelAction(f: FormData) {
  const u = await requireUser(["admin", "exploitant"]);
  const service = str(f, "service") === "climatisation" ? "climatisation" : "chauffage";
  const brand = str(f, "brand"), model = str(f, "model");
  if (!brand || !model) redirect("/admin/materiel?err=Marque+et+modèle+obligatoires");
  const db = getDb();
  const [m] = await db.insert(equipmentModels).values({
    service, brand: brand.slice(0, 80), model: model.slice(0, 120),
    manufacturerRef: str(f, "manufacturerRef").slice(0, 60) || null,
    electricalPowerW: intOrNull(str(f, "electricalPowerW")),
    coolingPowerW: intOrNull(str(f, "coolingPowerW")),
    noticeUrl: /^https:\/\//.test(str(f, "noticeUrl")) ? str(f, "noticeUrl").slice(0, 500) : null,
    noticeVersion: str(f, "noticeVersion").slice(0, 120) || null,
    placementRestrictions: str(f, "placementRestrictions").slice(0, 1000) || null,
    referenceVerified: f.get("referenceVerified") === "on",
  }).returning();
  await audit(db, u.id, "equipment_model.create", "equipment_model", m.id);
  redirect("/admin/materiel?ok=Modèle+ajouté");
}

/** Ajout d'un LOT d'appareils identiques : codes internes distincts générés à la suite (RC-011, RC-012…). */
export async function unitsAction(f: FormData) {
  const u = await requireUser(["admin", "exploitant"]);
  const modelId = uuid(str(f, "modelId"));
  const count = Math.min(100, Math.max(1, Number(str(f, "count")) || 1));
  const serials = str(f, "serials").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  if (serials.length && serials.length !== count) redirect("/admin/materiel?err=Le+nombre+de+numéros+de+série+doit+correspondre+à+la+quantité+(ou+laisser+vide)");
  const lot = str(f, "lotNumber").slice(0, 60) || null;
  const condition = "a_controler" as const; // P0-A : tout nouvel appareil passe par le contrôle technique
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE equipment_units IN SHARE ROW EXCLUSIVE MODE`);
    const [{ max }] = await tx.execute<{ max: number }>(sql`SELECT coalesce(max(substring(inventory_code from '^RC-(\\d+)$')::int), 0) AS max FROM equipment_units`);
    await tx.insert(equipmentUnits).values(Array.from({ length: count }, (_, i) => ({
      inventoryCode: `RC-${String(Number(max) + i + 1).padStart(3, "0")}`,
      modelId, lotNumber: lot, serialNumber: serials[i] ?? null, condition,
      conditionCheckedAt: null,
    })));
  });
  await audit(db, u.id, "equipment_units.create", "equipment_model", modelId, { count });
  redirect(`/admin/materiel?ok=${count}+appareil(s)+ajouté(s)`);
}

/** Mise à l'écart manuelle (à contrôler / hors service). Rendre un appareil louable passe OBLIGATOIREMENT par le contrôle technique. */
export async function unitConditionAction(f: FormData) {
  const u = await requireUser(["admin", "exploitant", "preparateur"]);
  const id = uuid(str(f, "unitId"));
  const condition = str(f, "condition");
  if (!["a_controler", "hors_service"].includes(condition)) redirect("/admin/materiel?err=Pour+rendre+un+appareil+louable,+enregistrez+un+contrôle+technique");
  const reason = str(f, "reason");
  if (reason.length < 3) redirect("/admin/materiel?err=Motif+de+mise+à+l'écart+obligatoire");
  await getDb().update(equipmentUnits).set({ condition: condition as "a_controler" }).where(eq(equipmentUnits.id, id));
  await audit(getDb(), u.id, "equipment_unit.condition", "equipment_unit", id, { condition, reason });
  redirect("/admin/materiel?ok=Appareil+mis+à+l'écart");
}

export async function inspectionAction(f: FormData) {
  const u = await requireUser(["admin", "exploitant", "preparateur"]);
  const id = uuid(str(f, "unitId"));
  const d = str(f, "date"), t = str(f, "time");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) redirect("/admin/materiel?err=Date+et+heure+du+contrôle+obligatoires#controles");
  const decision = (["neuf", "bon", "hors_service"].includes(str(f, "decision")) ? str(f, "decision") : "") as "bon";
  const r = await recordInspection(getDb(), { id: u.id, role: u.role }, id, {
    inspectedAt: parisLocalToUtc(d, t), inspectorName: str(f, "inspectorName"), anomalies: str(f, "anomalies"), decision,
    checks: Object.fromEntries(INSPECTION_CHECKS.map((c) => [c.key, f.get(`check_${c.key}`) === "on"])),
  });
  redirect(`/admin/materiel?${r.ok ? "ok" : "err"}=${encodeURIComponent((r.ok ? r.message : r.error) ?? "")}#controles`);
}

export async function scanAction(f: FormData) {
  const u = await requireUser(["admin", "preparateur", "exploitant"]);
  const id = uuid(str(f, "id"));
  const scan = await readScan(f);
  if (!scan) back(id, { ok: false, error: "Choisissez le fichier du bon signé (PDF ou photo)." });
  back(id, await attachSignedBon(getDb(), { id: u.id, role: u.role }, uuid(str(f, "handoverId")), scan!));
}

export async function resolveIncidentAction(f: FormData) {
  const u = await requireUser(["admin"]);
  const ret = str(f, "return");
  const r = await resolveIncident(getDb(), { id: u.id, role: u.role }, uuid(str(f, "incidentId")), str(f, "note"));
  const base = ret.startsWith("/admin") ? ret : "/admin";
  redirect(`${base}${base.includes("?") ? "&" : "?"}${r.ok ? "ok" : "err"}=${encodeURIComponent((r.ok ? r.message : r.error) ?? "")}`);
}

export async function userCreateAction(f: FormData) {
  const u = await requireUser(["admin"]);
  const role = (["admin", "commercial", "preparateur", "exploitant"].includes(str(f, "role")) ? str(f, "role") : "commercial") as "admin";
  try {
    const n = await createAdminUser(getDb(), { email: str(f, "email"), name: str(f, "name"), password: String(f.get("password") ?? ""), role });
    await audit(getDb(), u.id, "admin.create", "admin_user", n.id, { role });
  } catch (e) {
    const msg = (e as { code?: string; cause?: { code?: string } }).cause?.code === "23505" ? "Email déjà utilisé." : (e as Error).message;
    redirect(`/admin/comptes?err=${encodeURIComponent(msg)}`);
  }
  redirect("/admin/comptes?ok=Compte+créé");
}

export async function userActiveAction(f: FormData) {
  const u = await requireUser(["admin"]);
  try {
    await setUserActive(getDb(), u.id, uuid(str(f, "userId")), str(f, "active") === "true");
  } catch (e) {
    redirect(`/admin/comptes?err=${encodeURIComponent((e as Error).message)}`);
  }
  redirect("/admin/comptes?ok=Compte+mis+à+jour");
}

export async function userPasswordAction(f: FormData) {
  const u = await requireUser(["admin"]);
  try {
    await resetUserPassword(getDb(), u.id, uuid(str(f, "userId")), String(f.get("password") ?? ""));
  } catch (e) {
    redirect(`/admin/comptes?err=${encodeURIComponent((e as Error).message)}`);
  }
  redirect("/admin/comptes?ok=Mot+de+passe+réinitialisé+(sessions+révoquées)");
}
