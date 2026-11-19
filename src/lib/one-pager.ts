import { formatDate, formatMoney } from "./format";
import type { PayoffRow } from "./present";
import type { FrozenSnapshot, FrozenYear } from "./snapshot";

/** Printed page boxes. The sheet is the overlap, so one layout fits both. */
export const PAGE_MARGIN_MM = 12;
export const A4_MM = { width: 210, height: 297 };
export const LETTER_MM = { width: 215.9, height: 279.4 };

const printableWidth = Math.min(A4_MM.width, LETTER_MM.width) - PAGE_MARGIN_MM * 2;
const printableHeight = Math.min(A4_MM.height, LETTER_MM.height) - PAGE_MARGIN_MM * 2;

/** A little inside the shorter page so rounding cannot spill onto a second sheet. */
export const SHEET_WIDTH_MM = Math.floor(printableWidth) - 2;
export const SHEET_HEIGHT_MM = Math.floor(printableHeight) - 4;
export const COLUMN_GAP_MM = 4;
export const LEFT_COLUMN_MM = 70;
export const RIGHT_COLUMN_MM = SHEET_WIDTH_MM - COLUMN_GAP_MM - LEFT_COLUMN_MM;

export const ONE_PAGER_CSS = `
@page {
  margin: ${PAGE_MARGIN_MM}mm;
  size: A4 portrait;
}
@media print {
  @page {
    margin: ${PAGE_MARGIN_MM}mm;
    size: letter portrait;
  }
  html, body, main { background: #fff !important; }
  .pdf-sheet { box-shadow: none !important; }
}
.pdf-sheet {
  box-sizing: border-box;
  width: ${SHEET_WIDTH_MM}mm;
  height: ${SHEET_HEIGHT_MM}mm;
  display: grid;
  grid-template-columns: ${LEFT_COLUMN_MM}mm ${RIGHT_COLUMN_MM}mm;
  column-gap: ${COLUMN_GAP_MM}mm;
  background: #fff;
  color: #171717;
  line-height: 1.2;
  overflow: visible;
  break-inside: avoid;
  page-break-inside: avoid;
}
.pdf-col { min-width: 0; display: flex; flex-direction: column; }
.pdf-note { margin-top: auto; padding-top: 1.5mm; }
.pdf-schedule { width: 100%; border-collapse: collapse; }
.pdf-schedule th, .pdf-schedule td { padding: 0 0.6mm 0 0; vertical-align: top; font-weight: 400; text-align: left; }
`.trim();

export type ScheduleLine = {
  when: string;
  payment: string;
  interest: string;
  balance: string;
  cleared: string;
  kind: "month" | "year";
  /** Months from the full schedule this printed row stands for. */
  covered: number;
};

export type PointSize = 7 | 8;

export type OnePagerContent = {
  name: string;
  advisorDate: string;
  title: string;
  today: string[];
  plan: string[];
  payoff: PayoffRow[];
  advantages: string[];
  things: string[];
  edits: string[];
  note: string;
  schedule: ScheduleLine[];
  schedulePoint: PointSize;
  leftPoint: PointSize;
  scheduleHeightMm: number;
  leftHeightMm: number;
};

const LINE_FACTOR = 1.2;

function lineMm(point: number): number {
  return (point * LINE_FACTOR * 25.4) / 72;
}

function wrapLines(text: string, point: number, widthMm: number): number {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return 1;
  const widthPt = (widthMm / 25.4) * 72;
  const capacity = Math.max(4, Math.floor(widthPt / (point * 0.5)));
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const chunks = Math.max(1, Math.ceil(word.length / capacity));
    const first = Math.min(word.length, capacity);
    if (used > 0 && used + 1 + first > capacity) {
      lines += 1;
      used = 0;
    }
    if (chunks > 1) {
      lines += chunks - 1;
      used = word.length - (chunks - 1) * capacity;
      if (used === capacity) used = 0;
    } else {
      used += (used > 0 ? 1 : 0) + word.length;
    }
  }
  return lines;
}

function blockHeight(lines: readonly string[], point: number, widthMm: number, gapMm = 0): number {
  const line = lineMm(point);
  return lines.reduce((sum, text) => sum + wrapLines(text, point, widthMm) * line, 0) + gapMm;
}

function parseMoney(value: string): number {
  const amount = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function clearedNames(value: string): string[] {
  return value.split(", ").map((name) => name.trim()).filter((name) => name !== "" && name !== "None");
}

/** First 24 months one row each, then one row per calendar year for the rest. */
export function compactSchedule(years: readonly FrozenYear[]): ScheduleLine[] {
  const months = years.flatMap((year) => year.months);
  const head = months.slice(0, 24).map((month) => ({
    when: month.label,
    payment: month.payment,
    interest: month.interest,
    balance: month.balance,
    cleared: clearedNames(month.cleared).join(", "),
    kind: "month" as const,
    covered: 1,
  }));
  const rest = months.slice(24);
  const groups = new Map<string, typeof rest>();
  for (const month of rest) {
    const year = month.label.slice(-4);
    const list = groups.get(year) ?? [];
    list.push(month);
    groups.set(year, list);
  }
  const yearly = [...groups.entries()].map(([year, rows]) => {
    const cleared: string[] = [];
    for (const row of rows) {
      for (const name of clearedNames(row.cleared)) {
        if (!cleared.includes(name)) cleared.push(name);
      }
    }
    const last = rows[rows.length - 1];
    return {
      when: year,
      payment: formatMoney(rows.reduce((sum, row) => sum + parseMoney(row.payment), 0)),
      interest: formatMoney(rows.reduce((sum, row) => sum + parseMoney(row.interest), 0)),
      balance: last?.balance ?? "",
      cleared: cleared.join(", "),
      kind: "year" as const,
      covered: rows.length,
    };
  });
  return [...head, ...yearly];
}

/** Agreements saved before this wording still print the current heading. */
export function recommendedTitle(planName: string): string {
  if (planName.startsWith("Your plan:")) return `Your recommended plan:${planName.slice("Your plan:".length)}`;
  return planName;
}

/** Agreements saved before the payoff table still print the current columns. */
export function payoffRows(payoff: readonly { debt?: string; rate?: string; name?: string; when: string }[]): PayoffRow[] {
  return payoff.map((step) => {
    const when = step.when === "When the plan starts" ? "Upon starting new plan (Dec 2026)" : step.when;
    if (step.debt) return { debt: step.debt, rate: step.rate || "—", when };
    const name = step.name ?? "Debt";
    const parts = name.split(" · ");
    const rate = parts.length > 1 && parts[parts.length - 1]?.endsWith("%") ? parts[parts.length - 1]! : "—";
    const debt = rate === "—" ? name : parts.slice(0, -1).join(" · ");
    return { debt, rate, when };
  });
}

export function interestSavedLine(value: string): string {
  if (value.startsWith("$")) return `Interest saved ${value}`;
  if (value === "Not comparable") return "Interest saved is not comparable";
  if (value === "The same") return "Interest is the same";
  return value;
}

function debtFreeLine(value: string): string {
  return /^[A-Z][a-z]{2} \d{4}$/.test(value) ? `Debt free by ${value}` : value;
}

function moneyLine(label: string, value: string): string {
  if (value === "Not comparable") return `${label} is not comparable`;
  return `${label} ${value}`;
}

function measureSchedule(lines: readonly ScheduleLine[], point: number): number {
  const line = lineMm(point);
  let height = wrapLines("Your schedule", point, RIGHT_COLUMN_MM) * line;
  height += 1;
  height += wrapLines("Monthly for the first 2 years, then yearly.", point, RIGHT_COLUMN_MM) * line;
  height += 1.5;
  height += line;
  for (const row of lines) {
    const cells = [
      wrapLines(row.when, point, 18),
      wrapLines(row.payment, point, 16),
      wrapLines(row.interest, point, 16),
      wrapLines(row.balance, point, 18),
      wrapLines(row.cleared, point, 36),
    ];
    height += Math.max(1, ...cells) * line;
  }
  return height;
}

function measureLeft(input: {
  name: string;
  advisorDate: string;
  title: string;
  today: readonly string[];
  plan: readonly string[];
  payoff: readonly PayoffRow[];
  advantages: readonly string[];
  things: readonly string[];
  edits: readonly string[];
  note: string;
}, point: number): number {
  const width = LEFT_COLUMN_MM;
  let height = blockHeight([input.name, input.advisorDate], point + 1, width);
  height += 1.5;
  height += blockHeight([input.title], 11, width);
  height += 2;
  height += blockHeight(["Today", ...input.today], point, width, 1);
  height += blockHeight(["Your recommended plan", ...input.plan], point, width, 2);
  height += blockHeight(["Payoff order"], point, width, 2);
  height += lineMm(point);
  for (const row of input.payoff) {
    const cells = [
      1,
      wrapLines(row.debt, point, 22),
      wrapLines(row.rate, point, 14),
      wrapLines(row.when, point, 28),
    ];
    height += Math.max(...cells) * lineMm(point);
  }
  if (input.advantages.length > 0) height += blockHeight(["What's good about this plan", ...input.advantages], point, width, 2);
  if (input.things.length > 0) height += blockHeight(["Things to know", ...input.things], point, width, 2);
  if (input.edits.length > 0) height += blockHeight(["Data edits, if any", ...input.edits], point, width, 2);
  height += 2;
  height += blockHeight([input.note], point, width);
  return height;
}

/** Words and the type size that keep both columns inside the sheet. */
export function onePagerContent(snapshot: FrozenSnapshot): OnePagerContent {
  const schedule = compactSchedule(snapshot.years ?? []);
  const payoff = payoffRows(snapshot.payoff ?? []);
  const plan = [
    debtFreeLine(snapshot.plan.debtFree),
    snapshot.monthsSooner,
    moneyLine("Total interest", snapshot.plan.interest),
    interestSavedLine(snapshot.interestSaved),
    moneyLine("Monthly payment", snapshot.plan.monthly),
    ...(snapshot.loan ? [snapshot.loan] : []),
  ];
  const base = {
    name: snapshot.name,
    advisorDate: `${snapshot.advisor} · ${formatDate(snapshot.frozen_at)}`,
    title: recommendedTitle(snapshot.planName || snapshot.name),
    today: [
      debtFreeLine(snapshot.today.debtFree),
      moneyLine("Total interest", snapshot.today.interest),
      moneyLine("Monthly payment", snapshot.today.monthly),
    ],
    plan,
    payoff,
    advantages: snapshot.advantages ?? [],
    things: snapshot.thingsToKnow ?? [],
    edits: snapshot.dataEdits ?? [],
    note: snapshot.note,
    schedule,
  };
  const advisorDate = base.advisorDate;
  let schedulePoint: PointSize = 8;
  let leftPoint: PointSize = 8;
  let scheduleHeightMm = measureSchedule(schedule, schedulePoint);
  let leftHeightMm = measureLeft({ ...base, advisorDate }, leftPoint);
  if (scheduleHeightMm > SHEET_HEIGHT_MM || leftHeightMm > SHEET_HEIGHT_MM) {
    schedulePoint = 7;
    leftPoint = 7;
    scheduleHeightMm = measureSchedule(schedule, schedulePoint);
    leftHeightMm = measureLeft({ ...base, advisorDate }, leftPoint);
  }
  return { ...base, advisorDate, schedulePoint, leftPoint, scheduleHeightMm, leftHeightMm };
}
