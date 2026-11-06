import { getDb, isConnectionError } from "@/db/client";
import { estimateQuerySchema } from "@/lib/validation/request";
import { computeNeedAndPrice } from "@/server/preorders";
import { getActiveSettingsCached } from "@/server/settings-store";
import { json, jsonError, readJsonBody } from "@/server/http";
import { quantityWarnings } from "@/lib/domain/heating";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Estimation calculée côté serveur avec la grille active (aucun enregistrement). */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await readJsonBody(req, 8000);
  } catch {
    return jsonError(400, "invalid_json", "Format invalide.");
  }
  const parsed = estimateQuerySchema.safeParse(body);
  if (!parsed.success) return jsonError(422, "validation", "Paramètres incomplets.", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const q = parsed.data;
  try {
    const active = await getActiveSettingsCached(getDb());
    const build = (heating: typeof q.heating) => computeNeedAndPrice(
      {
        service: q.service,
        heating,
        cooling: q.cooling,
        site: { placeType: q.placeType, elevator: "inconnu", multiSite: q.multiSite ?? false },
        schedule: {
          desiredStartDate: "2000-01-01",
          durationUnknown: q.durationUnknown ?? q.estimatedDays == null,
          estimatedDays: q.estimatedDays ?? null,
          expressRequested: q.expressRequested ?? false,
        },
        delivery: { address: { postalCode: q.postalCode ?? "00000", line1: "-", city: "-" }, recipientName: "-", recipientPhone: "-" },
      } as Parameters<typeof computeNeedAndPrice>[0],
      active.settings,
    );
    let calc = build(q.heating);
    if (q.quantityMode === "recommended" && q.heating && calc.heating) {
      calc = build({ ...q.heating, quantityRequested: Math.min(calc.heating.recommendedUnits, active.settings.heating.sizing.maxSelectableUnits) });
    }
    const s = active.settings.heating.sizing;
    return json({
      ok: true,
      pricingVersion: active.version,
      postalCodeKnown: !!q.postalCode,
      heating: calc.heating,
      cooling: calc.cooling,
      quantity: calc.quantity,
      quantityWarnings: calc.heating ? quantityWarnings(calc.quantity, calc.heating.recommendedUnits, active.settings, q.placeType) : [],
      price: calc.price,
      requiresManualReview: calc.requiresManualReview,
      unitPowerW: s.unitPowerW,
      maxSelectableUnits: s.maxSelectableUnits,
      vatApplicable: active.settings.vatApplicable,
      coolingPricingEnabled: active.settings.cooling.pricingEnabled,
    });
  } catch (e) {
    if (isConnectionError(e)) return jsonError(503, "db_unavailable", "Estimation momentanément indisponible.");
    if (e instanceof RangeError) return jsonError(422, "validation", e.message);
    console.error("[estimate]", (e as Error).message);
    return jsonError(500, "server_error", "Estimation impossible.");
  }
}
