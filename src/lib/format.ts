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
