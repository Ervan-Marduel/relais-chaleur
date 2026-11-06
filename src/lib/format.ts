export const TZ = "Europe/Paris";

export function formatEuros(cents: number | null | undefined) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/** Date ISO (YYYY-MM-DD) → « 12/11/2026 » sans décalage de fuseau. */
export function formatIsoDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(date);
}

export function yearInParis(d = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric" }).format(d));
}

/** Aujourd'hui (Europe/Paris) au format YYYY-MM-DD. */
export function todayInParis(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Convertit une date + heure locales de Paris (saisies dans le back-office) en instant UTC,
 * en tenant compte des changements d'heure.
 */
export function parisLocalToUtc(dateIso: string, time = "00:00"): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // décalage de Paris à cet instant
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)!.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
