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

const CARD_PAD_MM = 6;
const COLUMN_GAP_MM = 6;

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
  padding: ${CARD_PAD_MM}mm;
  display: flex;
  flex-direction: column;
  gap: 3.5mm;
  background: #fff;
  color: #171717;
  line-height: 1.35;
  border: 0.25mm solid #e5e5e5;
  border-radius: 2mm;
  overflow: hidden;
  break-inside: avoid;
  page-break-inside: avoid;
}
.pdf-sheet p, .pdf-sheet h2, .pdf-sheet h3, .pdf-sheet ul, .pdf-sheet ol { margin: 0; }
.pdf-sheet ul { padding-left: 4mm; }
.pdf-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6mm;
  padding-bottom: 3mm;
  border-bottom: 0.25mm solid #e5e5e5;
}
.pdf-name { color: #737373; font-size: 0.82em; }
.pdf-title { margin-top: 0.8mm; font-size: 1.55em; font-weight: 700; line-height: 1.2; }
.pdf-meta { text-align: right; }
.pdf-compare { display: grid; grid-template-columns: 1fr 1fr; gap: ${COLUMN_GAP_MM}mm; }
.pdf-label { color: #737373; font-size: 0.82em; margin-bottom: 1mm; }
.pdf-payoff { columns: 2; column-gap: 8mm; padding-left: 5mm; }
.pdf-payoff li { break-inside: avoid; }
.pdf-note {
  margin-top: auto;
  padding-top: 2mm;
  border-top: 0.25mm solid #e5e5e5;
  color: #737373;
  font-size: 0.82em;
}
`.trim();

export type PointSize = 11 | 9;

export type OnePagerContent = {
  name: string;
  advisor: string;
  date: string;
  title: string;
  today: string[];
  plan: string[];
  loan: string | null;
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

/** One printed payoff line: "Debt · rate — date". */
export function payoffLine(row: PayoffRow): string {
  return `${row.debt} · ${row.rate} — ${row.when}`;
}

/** The household's advisor of record, not the person who opened the page. */
export function householdAdvisor(snapshot: FrozenSnapshot): string {
  return snapshot.inputs.household.advisor;
}

function measureSheet(input: {
  name: string;
  advisor: string;
  date: string;
  title: string;
  today: readonly string[];
  plan: readonly string[];
  loan: string | null;
  payoff: readonly PayoffRow[];
  advantages: readonly string[];
  things: readonly string[];
  edits: readonly string[];
  note: string;
}, point: number): number {
  const inner = SHEET_WIDTH_MM - CARD_PAD_MM * 2;
  const column = (inner - COLUMN_GAP_MM) / 2;
  const titleWidth = inner - 42;
  const leftHead = blockHeight([input.name], point * 0.82, titleWidth) + 0.8 + blockHeight([input.title], point * 1.55, titleWidth);
  const rightHead = blockHeight([input.advisor, input.date], point, 40);
  let height = CARD_PAD_MM * 2;
  height += Math.max(leftHead, rightHead) + 3;
  height += 3.5;
  height += Math.max(
    blockHeight(["Today", ...input.today], point, column),
    blockHeight(["Your recommended plan", ...input.plan], point, column),
  );
  height += 3.5;
  height += blockHeight(["Order your debts are paid off"], point * 0.82, inner);
  const payoffHeights = input.payoff.map((row) => wrapLines(payoffLine(row), point, column - 6) * lineMm(point));
  const payoffTotal = payoffHeights.reduce((sum, row) => sum + row, 0);
  const tallest = payoffHeights.reduce((max, row) => Math.max(max, row), lineMm(point));
  height += input.payoff.length === 0 ? lineMm(point) : payoffTotal / 2 + tallest;
  if (input.loan) {
    height += 3.5;
    height += blockHeight([input.loan], point, inner);
  }
  if (input.advantages.length > 0) {
    height += 3.5;
    height += blockHeight(["What's good about this plan", ...input.advantages], point, inner);
  }
  if (input.things.length > 0) {
    height += 3.5;
    height += blockHeight(["Things to know", ...input.things], point, inner);
  }
  if (input.edits.length > 0) {
    height += 3.5;
    height += blockHeight(["Data edits, if any", ...input.edits], point, inner);
  }
  height += 3.5;
  height += blockHeight([input.note], point * 0.82, inner) + 2;
  return height;
}

/** Words and the type size that keep the summary inside the sheet. */
export function onePagerContent(snapshot: FrozenSnapshot): OnePagerContent {
  const payoff = payoffRows(snapshot.payoff ?? []);
  const base = {
    name: snapshot.name,
    advisor: householdAdvisor(snapshot),
    date: formatDate(snapshot.frozen_at),
    title: recommendedTitle(snapshot.planName || snapshot.name),
    today: [
      debtFreeLine(snapshot.today.debtFree),
      moneyLine("Total interest", snapshot.today.interest),
      moneyLine("Monthly payment", snapshot.today.monthly),
    ],
    plan: [
      debtFreeLine(snapshot.plan.debtFree),
      moneyLine("Total interest", snapshot.plan.interest),
      interestSavedLine(snapshot.interestSaved),
      moneyLine("Monthly payment", snapshot.plan.monthly),
      snapshot.monthsSooner,
    ],
    loan: snapshot.loan,
    payoff,
    advantages: snapshot.advantages ?? [],
    things: snapshot.thingsToKnow ?? [],
    edits: snapshot.dataEdits ?? [],
    note: snapshot.note,
  };
  let point: PointSize = 11;
  let heightMm = measureSheet(base, point);
  if (heightMm > SHEET_HEIGHT_MM) {
    point = 9;
    heightMm = measureSheet(base, point);
  }
  return { ...base, point, heightMm };
}
