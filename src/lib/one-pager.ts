import { formatDate } from "./format";
import type { PayoffRow } from "./present";
import type { FrozenSnapshot } from "./snapshot";

/** Printed page boxes. The sheet is the overlap, so one layout fits both. */
export const PAGE_MARGIN_MM = 12;
export const A4_MM = { width: 210, height: 297 };
export const LETTER_MM = { width: 215.9, height: 279.4 };

const printableWidth = Math.min(A4_MM.width, LETTER_MM.width) - PAGE_MARGIN_MM * 2;
const printableHeight = Math.min(A4_MM.height, LETTER_MM.height) - PAGE_MARGIN_MM * 2;

/** A little inside the shorter page so rounding cannot spill onto a second sheet. */
export const SHEET_WIDTH_MM = Math.floor(printableWidth) - 2;
export const SHEET_HEIGHT_MM = Math.floor(printableHeight) - 4;

const PAYOFF_NUMBER_MM = 8;
const PAYOFF_RATE_MM = 28;
const PAYOFF_WHEN_MM = 62;
const PAYOFF_DEBT_MM = SHEET_WIDTH_MM - PAYOFF_NUMBER_MM - PAYOFF_RATE_MM - PAYOFF_WHEN_MM;

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
  display: flex;
  flex-direction: column;
  background: #fff;
  color: #171717;
  line-height: 1.2;
  overflow: hidden;
  break-inside: avoid;
  page-break-inside: avoid;
}
.pdf-sheet p, .pdf-sheet h2, .pdf-sheet h3, .pdf-sheet ul { margin: 0; }
.pdf-sheet ul { padding-left: 4mm; }
.pdf-note { margin-top: auto; padding-top: 1.5mm; }
.pdf-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.pdf-table th, .pdf-table td {
  padding: 0 1.5mm 0 0;
  vertical-align: top;
  font-weight: 400;
  text-align: left;
  white-space: nowrap;
}
`.trim();

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
  point: PointSize;
  heightMm: number;
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

function blockHeight(lines: readonly string[], point: number, widthMm: number): number {
  const line = lineMm(point);
  return lines.reduce((sum, text) => sum + wrapLines(text, point, widthMm) * line, 0);
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

function measureSheet(input: {
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
  const width = SHEET_WIDTH_MM;
  let height = blockHeight([input.name, input.advisorDate], point, width);
  height += 1.5;
  height += blockHeight([input.title], 11, width);
  height += 2;
  height += blockHeight(["Today", ...input.today], point, width);
  height += 2;
  height += blockHeight(["Your recommended plan", ...input.plan], point, width);
  height += 2;
  height += blockHeight(["Payoff order"], point, width);
  height += lineMm(point);
  for (const row of input.payoff) {
    const cells = [
      1,
      wrapLines(row.debt, point, PAYOFF_DEBT_MM),
      wrapLines(row.rate, point, PAYOFF_RATE_MM),
      wrapLines(row.when, point, PAYOFF_WHEN_MM),
    ];
    height += Math.max(...cells) * lineMm(point);
  }
  if (input.advantages.length > 0) {
    height += 2;
    height += blockHeight(["What's good about this plan", ...input.advantages], point, width);
  }
  if (input.things.length > 0) {
    height += 2;
    height += blockHeight(["Things to know", ...input.things], point, width);
  }
  if (input.edits.length > 0) {
    height += 2;
    height += blockHeight(["Data edits, if any", ...input.edits], point, width);
  }
  height += 1.5;
  height += blockHeight([input.note], point, width);
  return height;
}

/** Words and the type size that keep the summary inside the sheet. */
export function onePagerContent(snapshot: FrozenSnapshot): OnePagerContent {
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
  };
  let point: PointSize = 8;
  let heightMm = measureSheet(base, point);
  if (heightMm > SHEET_HEIGHT_MM) {
    point = 7;
    heightMm = measureSheet(base, point);
  }
  return { ...base, point, heightMm };
}
