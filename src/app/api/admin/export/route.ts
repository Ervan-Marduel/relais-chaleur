import { getDb } from "@/db/client";
import { currentUser } from "@/server/auth";
import { audit, listRequests, type RequestFilters } from "@/server/admin-data";
import { getActiveSettings } from "@/server/settings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  if (v == null) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise l'injection de formules (tableurs)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Export CSV (séparateur « ; », UTF-8 BOM pour Excel) — admin et commercial uniquement, tracé. */
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return new Response("Non autorisé", { status: 401 });
  if (!["admin", "commercial"].includes(u.role)) return new Response("Interdit", { status: 403 });
  const url = new URL(req.url);
  const f = Object.fromEntries(url.searchParams.entries()) as RequestFilters;
  const db = getDb();
  const zone = (await getActiveSettings(db)).settings.zones.flatMap((z) => z.postalCodes);
  const rows = await listRequests(db, f, zone, 10_000);
  const cols = [
    "reference", "createdAt", "status", "service", "customerKind", "companyName", "contactName", "phone", "email",
    "recipientName", "postalCode", "city", "desiredStartDate", "estimatedDays", "quantityRecommended", "quantityRequested",
    "quoteMode", "totalHt", "totalTtc", "requiresManualReview", "isErp", "expressRequested", "multiSite", "firstContactAt", "utmSource",
  ] as const;
  const lines = [cols.join(";"), ...rows.map((r) => cols.map((c) => esc(c === "totalHt" || c === "totalTtc" ? (r[c] == null ? null : (r[c]! / 100).toFixed(2)) : r[c])).join(";"))];
  await audit(db, u.id, "requests.export", "requests", undefined, { count: rows.length, filters: f });
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="demandes-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
