import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { equipmentUnits } from "@/db/schema";
import { INSPECTION_CHECKS, recordInspection, type Actor } from "@/server/request-ops";

export const ALL_CHECKS_OK = Object.fromEntries(INSPECTION_CHECKS.map((c) => [c.key, true]));

/** Crée des appareils (entrée « à contrôler ») puis les fait passer par un vrai contrôle technique. */
export async function createInspectedUnits(db: Db, actor: Actor, rows: { inventoryCode: string; modelId: string; lotNumber?: string | null; decision?: "neuf" | "bon" | "hors_service" | "none" }[]) {
  for (const r of rows) {
    const [u] = await db.insert(equipmentUnits).values({ inventoryCode: r.inventoryCode, modelId: r.modelId, lotNumber: r.lotNumber ?? null }).returning();
    const decision = r.decision ?? "neuf";
    if (decision === "none") continue;
    const res = await recordInspection(db, actor, u.id, {
      inspectedAt: new Date(Date.now() - 60_000), inspectorName: "Contrôleur test", checks: ALL_CHECKS_OK,
      anomalies: decision === "hors_service" ? "Résistance défaillante" : "", decision,
    });
    if (!res.ok) throw new Error(res.error);
  }
}

export async function inspect(db: Db, actor: Actor, inventoryCode: string, decision: "bon" | "hors_service" = "bon", checks = ALL_CHECKS_OK) {
  const [u] = await db.select().from(equipmentUnits).where(eq(equipmentUnits.inventoryCode, inventoryCode));
  return recordInspection(db, actor, u.id, { inspectedAt: new Date(), inspectorName: "Contrôleur", checks, anomalies: decision === "hors_service" ? "Cordon endommagé" : "", decision });
}
