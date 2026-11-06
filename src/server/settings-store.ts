import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { pricingVersions } from "@/db/schema";
import { businessSettingsSchema, type BusinessSettings } from "@/lib/domain/settings";
import { defaultBusinessSettings } from "@config/business";

export type ActiveSettings = { id: string; version: number; settings: BusinessSettings; createdAt: Date };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function getActiveSettings(db: Db | Tx): Promise<ActiveSettings> {
  const [row] = await db.select().from(pricingVersions).where(eq(pricingVersions.isActive, true)).limit(1);
  if (!row) throw new Error("Aucune version de paramètres active (lancez npm run db:seed)");
  return { id: row.id, version: row.version, settings: businessSettingsSchema.parse(row.payload), createdAt: row.createdAt };
}

export async function listSettingsVersions(db: Db) {
  return db.select({
    id: pricingVersions.id, version: pricingVersions.version, isActive: pricingVersions.isActive,
    note: pricingVersions.note, createdAt: pricingVersions.createdAt, createdBy: pricingVersions.createdBy,
  }).from(pricingVersions).orderBy(desc(pricingVersions.version));
}

/** Crée une nouvelle version immuable et l'active (l'ancienne reste consultable et liée aux demandes existantes). */
export async function publishSettingsVersion(db: Db, payload: unknown, actorId: string | null, note: string) {
  const settings = businessSettingsSchema.parse(payload);
  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE pricing_versions IN SHARE ROW EXCLUSIVE MODE`);
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${pricingVersions.version}), 0)` }).from(pricingVersions);
    await tx.update(pricingVersions).set({ isActive: false }).where(eq(pricingVersions.isActive, true));
    const [row] = await tx.insert(pricingVersions)
      .values({ version: Number(max) + 1, payload: settings, isActive: true, note, createdBy: actorId })
      .returning();
    return row;
  });
}

export async function ensureDefaultSettings(db: Db) {
  const [row] = await db.select({ id: pricingVersions.id }).from(pricingVersions).limit(1);
  if (!row) await publishSettingsVersion(db, defaultBusinessSettings, null, "Version initiale (config/business.ts)");
}

let cache: { at: number; value: ActiveSettings } | null = null;
/** Lecture mise en cache 30 s pour l'estimation en direct (le dépôt de demande relit toujours la base). */
export async function getActiveSettingsCached(db: Db): Promise<ActiveSettings> {
  if (cache && Date.now() - cache.at < 30_000 && process.env.NODE_ENV !== "test") return cache.value;
  const value = await getActiveSettings(db);
  cache = { at: Date.now(), value };
  return value;
}
export function invalidateSettingsCache() {
  cache = null;
}
