import { TZ } from "@/lib/format";
import type { BusinessSettings } from "./settings";

export type DayCountRule = BusinessSettings["rental"]["dayCountRule"];

export const DAY_RULE_LABEL: Record<NonNullable<DayCountRule>, string> = {
  calendar_inclusive: "jours calendaires, remise et reprise incluses",
  started_24h_periods: "périodes de 24 h entamées",
};

function parisDayNumber(d: Date) {
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, day) / 86400_000);
}

/**
 * Jours de location constatés entre la remise RÉELLE et la reprise RÉELLE.
 * Retourne null si aucune règle n'a été validée dans les conditions acceptées : on ne l'invente pas.
 */
export function rentalDays(deliveredAt: Date, returnedAt: Date, rule: DayCountRule): number | null {
  if (!(returnedAt > deliveredAt)) throw new RangeError("La reprise doit suivre la remise");
  if (rule === "calendar_inclusive") return parisDayNumber(returnedAt) - parisDayNumber(deliveredAt) + 1;
  if (rule === "started_24h_periods") return Math.max(1, Math.ceil((returnedAt.getTime() - deliveredAt.getTime()) / 86400_000 - 1e-9));
  return null;
}
