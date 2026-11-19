import { PLAN_START } from "./config";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Whole dollars, grouped, for example "$12,345". */
export function formatMoney(amount: number): string {
  return money.format(Math.round(amount));
}

/** Shown when today's payments never finish, so months and interest saved have no baseline. */
export const NOT_COMPARABLE = "Not comparable";

export const NOT_COMPARABLE_REASON =
  "Today's payments never clear the debt, so there's no interest total to compare against.";

/** Tooltip when today's path never finishes. Time is the best plan's debt-free span. */
export function neverComparableReason(time: string | null): string {
  if (!time) return "Today's payments never clear these debts.";
  return `Today's payments never clear these debts. With the best plan: debt free in ${time}.`;
}

/** The payment-alert tooltip. "$1,562 → $4,548 (+191%)". */
export function paymentAlertText(from: number, to: number, percent: number): string {
  return `Monthly payment ${formatMoney(from)} → ${formatMoney(to)} (${formatPercent(percent)})`;
}

/** 134 becomes "11 years 2 months". A plan that never finishes is "Never". */
export function formatMonths(months: number | null | "never"): string {
  if (months == null || months === "never") return "Never";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? "month" : "months"}`);
  return parts.length > 0 ? parts.join(" ") : "0 months";
}

/** Plan month 1 is December 2026, so month 4 is "Mar 2027". */
export function planDate(planMonth: number): string {
  const [year, month] = PLAN_START.split("-").map(Number);
  const index = year! * 12 + (month! - 1) + Math.max(planMonth, 1) - 1;
  return `${MONTHS[index % 12]} ${Math.floor(index / 12)}`;
}

/** ISO date to "4 Sep 2027". Parsed as a calendar date, not a timezone instant. */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

/**
 * Percentage points, rounded, with a sign. 191.2 becomes "+191%".
 * This matches `payment_change_pct` in the demo data, not a 0–1 ratio.
 */
export function formatPercent(percent: number): string {
  const rounded = Math.round(percent);
  if (rounded > 0) return `+${rounded}%`;
  return `${rounded}%`;
}
