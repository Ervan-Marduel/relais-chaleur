/**
 * Initialise la base :
 *   - version 1 des paramètres métier (config/business.ts) si la base est vierge ;
 *   - avec --demo : données de DÉMONSTRATION (modèle de test, 10 appareils, demandes fictives).
 * Ne jamais lancer --demo sur la base de production.
 *
 *   npm run db:seed              # paramètres uniquement
 *   npm run db:seed -- --demo    # + données de démonstration
 */
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { closeDb, getDb } from "../src/db/client";
import { adminUsers, equipmentModels, equipmentUnits } from "../src/db/schema";
import { ensureDefaultSettings } from "../src/server/settings-store";
import { INSPECTION_CHECKS, recordInspection } from "../src/server/request-ops";
import { createPreorder } from "../src/server/preorders";
import { requestPayloadSchema } from "../src/lib/validation/request";

const demo = process.argv.includes("--demo");
const db = getDb();

async function main() {
  await ensureDefaultSettings(db);
  console.log("Paramètres métier : OK");
  if (!demo) return;
  if (process.env.SITE_MODE === "production") throw new Error("Refus : --demo interdit avec SITE_MODE=production");

  const email = process.env.DEMO_ADMIN_EMAIL ?? "admin@demo.invalid";
  const password = process.env.DEMO_ADMIN_PASSWORD ?? "demo-admin-1234";
  const [existing] = await db.select().from(adminUsers).where(sql`lower(${adminUsers.email}) = ${email}`);
  if (!existing) {
    await db.insert(adminUsers).values({ email, name: "Admin démo", passwordHash: await bcrypt.hash(password, 12), role: "admin" });
    console.log(`Admin de démonstration : ${email} (mot de passe : DEMO_ADMIN_PASSWORD ou valeur par défaut de démo)`);
  }

  let [model] = await db.select().from(equipmentModels).where(eq(equipmentModels.manufacturerRef, "244177"));
  if (!model) {
    [model] = await db.insert(equipmentModels).values({
      service: "chauffage",
      brand: "VARMA",
      model: "Ingaro",
      manufacturerRef: "244177",
      electricalPowerW: 2000,
      noticeVersion: "À joindre (notice fabricant)",
      placementRestrictions: "Respecter les distances et consignes de la notice du fabricant.",
      referenceVerified: false, // DONNÉE DE TEST — à confirmer sur l'appareil et la notice
    }).returning();
    await db.insert(equipmentModels).values({
      service: "climatisation", brand: "À définir", model: "Climatiseur mobile (gamme non validée)", active: false,
    });
  }
  const units = await db.select().from(equipmentUnits);
  if (units.length === 0) {
    const [adm] = await db.select().from(adminUsers).where(sql`lower(${adminUsers.email}) = ${email}`);
    const inserted = await db.insert(equipmentUnits).values(
      Array.from({ length: 10 }, (_, i) => ({
        inventoryCode: `RC-${String(i + 1).padStart(3, "0")}`,
        modelId: model.id,
        serialNumber: null, // aucun numéro de série constructeur relevé : on ne l'invente pas
        lotNumber: "LOT-TEST-A", // lot commun : jamais utilisé comme identifiant unique
      })),
    ).returning();
    // Les appareils entrent « à contrôler » ; contrôle de réception fictif pour RC-001 à RC-008 (RC-009/010 restent à contrôler).
    for (const u of inserted.slice(0, 8)) {
      const r = await recordInspection(db, { id: adm.id, role: "admin" }, u.id, {
        inspectedAt: new Date(), inspectorName: "Contrôle de réception (démo)", anomalies: "", decision: "neuf",
        checks: Object.fromEntries(INSPECTION_CHECKS.map((c) => [c.key, true])),
      });
      if (!r.ok) throw new Error(r.error);
    }
    console.log("Parc de démonstration : RC-001 à RC-010 (RC-009 et RC-010 à contrôler)");
  }

  const mk = (o: Record<string, unknown>) => requestPayloadSchema.parse({
    idempotencyKey: randomUUID(),
    consent: { terms: true, privacy: true, termsVersion: "demo", privacyVersion: "demo" },
    ...o,
  });
  const samples = [
    mk({
      service: "chauffage",
      heating: { surfaceMode: "total", totalSurfaceM2: 25, rooms: 1, ceilingHeightM: 2.5, insulation: "bonne", quantityRequested: 1 },
      site: { placeType: "appartement", floor: "3", elevator: "oui", multiSite: false },
      schedule: { desiredStartDate: "2026-11-20", durationUnknown: false, estimatedDays: 7, expressRequested: false },
      customer: { kind: "particulier", contactName: "Camille Démo", phone: "06 00 00 00 01", email: "camille@demo.invalid" },
      delivery: { recipientName: "Camille Démo", recipientPhone: "06 00 00 00 01", address: { line1: "10 rue de Démonstration", postalCode: "69003", city: "Lyon" } },
    }),
    mk({
      service: "chauffage",
      heating: { surfaceMode: "detail", roomSurfaces: [18, 12, 22, 15, 20], ceilingHeightM: 2.5, insulation: "moyenne", quantityRequested: 5 },
      site: { placeType: "appartement", floor: "2", elevator: "non", multiSite: false },
      schedule: { desiredStartDate: "2026-11-18", durationUnknown: false, estimatedDays: 14, expressRequested: true },
      customer: { kind: "syndic", companyName: "Syndic Démo Gestion", siret: "73282932000074", contactName: "Alice Gestionnaire", phone: "04 00 00 00 02", email: "alice@demo.invalid", customerReference: "OS-2026-114" },
      delivery: { recipientName: "Bruno Locataire", recipientPhone: "07 00 00 00 03", address: { line1: "5 avenue Fictive", line2: "Bât. B", postalCode: "69100", city: "Villeurbanne" }, accessInstructions: "Code portail 1234 (fictif)" },
    }),
    mk({
      service: "climatisation",
      cooling: { surfaceM2: 30, rooms: 1, ceilingHeightM: 2.6, exposure: "sud", insulation: "moyenne", people: 4, exhaust: "fenetre", noiseSensitive: true, power: "oui" },
      site: { placeType: "bureau", elevator: "oui", multiSite: false },
      schedule: { desiredStartDate: "2027-06-15", durationUnknown: true, expressRequested: false },
      customer: { kind: "entreprise", companyName: "Bureau Démo SARL", contactName: "Denis Démo", phone: "06 00 00 00 04", email: "denis@demo.invalid" },
      delivery: { recipientName: "Denis Démo", recipientPhone: "06 00 00 00 04", address: { line1: "1 quai Imaginaire", postalCode: "69002", city: "Lyon" } },
    }),
  ];
  const [{ count }] = await db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM requests`);
  if (Number(count) === 0) {
    for (const s of samples) {
      const r = await createPreorder(db, s);
      console.log(`Demande de démonstration ${r.reference}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
