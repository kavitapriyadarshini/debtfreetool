import { cases, loanProducts, pipelineResults } from "./data";
import { amortise } from "./engine/amortise";
import { flags, householdFico, loadHousehold, todayPayment, validDebts, type FlagHit, type WorkingHousehold } from "./engine/household";
import { buildOffers, fastAppMiss, type BuiltOffer } from "./engine/offers";
import { paymentAlert, type PlanRisk } from "./engine/bestPlan";
import { paymentEventLines, type LoanStart, type PaymentDebt } from "./engine/paymentEvents";
import { pythonRound } from "./engine/round";
import { householdWithCase, runScenario, type CaseState } from "./engine/scenario";
import { monthIndex, simulate, type ExtraInput, type Strategy } from "./engine/simulate";
import { caseInputs, editedName, nightlyOnCase, normalizeSeededScenarios, planKey, type CaseInputs } from "./case-inputs";
import { CAP_MONTHS, PLAN_START, TIE_WINDOW_MONTHS } from "./config";
import { formatDate, formatMoney, formatMonths, formatPercent, formatRate, neverComparableReason, paymentAlertText, planDate, signedInterestSaved, signedMonthsSaved, NOT_COMPARABLE } from "./format";
import { editedValueLine } from "./household-overview";
import { describeFastAppMiss } from "./opportunity";
import type { CaseOverride, ExtraPayment, PaymentAlert, Property, Scenario } from "./types";

const MINIMUM: Record<string, number> = {
  FastApp: 10_000,
  "HELOAN Yellow": 25_000,
  "HELOAN Pink": 20_000,
};

const YELLOW = [
  { min: 740, residence: 0.85, investment: 0.75 },
  { min: 720, residence: 0.8, investment: 0.7 },
  { min: 680, residence: 0.75, investment: 0.65 },
  { min: 660, residence: 0.7, investment: 0.6 },
  { min: 640, residence: 0.6, investment: 0.5 },
];

const PINK = [
  { min: 740, residence: 0.9, investment: 0.75 },
  { min: 720, residence: 0.9, investment: 0.75 },
  { min: 680, residence: 0.85, investment: 0.7 },
];

const NOT_UNSECURED = new Set(["Mortgage", "Home equity loan", "Reverse mortgage"]);

/** The line under the scenario table. `today` is already formatted, such as "$3,620". */
export function paymentRule(today: string): string {
  return `Every plan pays at least today's ${today} a month; when a debt is paid off, its payment moves to the next debt (highest rate first for avalanche, smallest balance first for snowball).`;
}

export const NEVER_NOTE = "Never debt free at these payments";
export const BELOW_MINIMUM = "below minimum";
export const WONT_SAVE = "won't save money";
export const INCLUDES_EXTRAS = "Includes extra payments";
export const DUPLICATE_EXCLUDED = "Duplicate excluded in this case";
const SOURCE_LABELS = ["Today", "Built-in", "Built by you"] as const;
const HEADER_MARKS = ["Nightly best", "Suggested", "Previously recommended"] as const;
export const LOAN_MOVES_NOTHING = "This loan doesn't pay off any debt";
export const NAME_TAKEN = "That name is already used.";
export const NAME_REQUIRED = "Enter a name.";

export type DatedExtra = {
  type: ExtraPayment["type"];
  amount: number;
  startMonth: string;
};

/**
 * Day-one payment, then each later recurring extra.
 * A one-off does not change the monthly amount. The peak is what the alert uses.
 */
export function describePayment(
  base: number,
  extras: readonly DatedExtra[],
): { display: string; peak: number } {
  const recurring = extras.filter((extra) => extra.type === "recurring" && extra.amount > 0);
  let opening = base;
  const later = new Map<string, number>();
  for (const extra of recurring) {
    if (extra.startMonth <= PLAN_START) opening += extra.amount;
    else later.set(extra.startMonth, (later.get(extra.startMonth) ?? 0) + extra.amount);
  }
  let running = opening;
  const steps: string[] = [];
  for (const month of [...later.keys()].sort()) {
    running += later.get(month)!;
    steps.push(`${formatMoney(running)} from ${planDate(monthIndex(month))}`);
  }
  return {
    display: steps.length === 0 ? formatMoney(opening) : `${formatMoney(opening)}; ${steps.join("; ")}`,
    peak: running,
  };
}

/**
 * Current path keeps each debt's own payment, so the total falls the month after a debt clears.
 * The partial closing month is not a new level. Rollover plans do not use this.
 */
export function describeCurrentPayment(
  debts: readonly { id: string; payment: number }[],
  payoffMonths: Readonly<Record<string, number>>,
  spanMonths: number | null,
): { display: string; peak: number } {
  const opening = debts.reduce((sum, debt) => sum + debt.payment, 0);
  const lastMonth = spanMonths ?? CAP_MONTHS;
  const drops = new Map<number, number>();
  for (const debt of debts) {
    const paid = payoffMonths[debt.id];
    if (paid == null) continue;
    const from = paid + 1;
    if (from > lastMonth) continue;
    drops.set(from, (drops.get(from) ?? 0) + debt.payment);
  }
  let running = opening;
  const steps: string[] = [];
  for (const month of [...drops.keys()].sort((a, b) => a - b)) {
    running -= drops.get(month) ?? 0;
    steps.push(`${formatMoney(running)} from ${planDate(month)}`);
  }
  return {
    display: steps.length === 0 ? formatMoney(opening) : `${formatMoney(opening)}; ${steps.join("; ")}`,
    peak: opening,
  };
}

/** One line for the monthly-payment cell. The steps are the full list behind "Show all". */
export function paymentSummary(display: string): { summary: string; steps: string[] } {
  const steps = display.split("; ").filter((step) => step !== "");
  if (steps.length <= 1) return { summary: display, steps };
  const opening = steps[0]!;
  const later = steps.slice(1).map((step) => {
    const from = step.lastIndexOf(" from ");
    if (from === -1) return { amount: step, when: "" };
    return { amount: step.slice(0, from), when: step.slice(from + " from ".length) };
  });
  const openingAmount = Number(opening.replace(/[$,]/g, ""));
  const falling = later.every((step) => Number(step.amount.replace(/[$,]/g, "")) <= openingAmount);
  if (falling) {
    const last = later[later.length - 1]!;
    return { summary: `${opening} now · falls to ${last.amount} by ${last.when}`, steps };
  }
  const first = later[0]!;
  return { summary: `${opening} now · ${first.amount} from ${first.when}`, steps };
}

/** Who receives money left after each debt's own payment. */
export function spareMoney(
  strategy: Strategy,
  debts: readonly { name: string; rate: number; balance: number }[],
): string {
  if (strategy === "current" || debts.length === 0) {
    return "Each debt keeps its own payment, so the amount falls when a debt is paid off.";
  }
  let target = debts[0]!;
  for (const debt of debts.slice(1)) {
    if (strategy === "snowball") {
      if (debt.balance < target.balance) target = debt;
    } else if (debt.rate > target.rate) target = debt;
  }
  const why = strategy === "snowball" ? "the smallest balance" : "the highest rate";
  return `Spare money goes to ${target.name}, ${why}.`;
}

/** "a $13,300 lump sum in Dec 2026" or "an extra $300 a month from Sep 2027". */
export function extrasPhrase(extras: readonly DatedExtra[]): string {
  const parts = extras
    .filter((extra) => extra.amount > 0)
    .slice()
    .sort((a, b) => a.startMonth.localeCompare(b.startMonth) || a.type.localeCompare(b.type))
    .map((extra) => {
      const when = planDate(monthIndex(extra.startMonth));
      if (extra.type === "one_off") return `a ${formatMoney(extra.amount)} lump sum in ${when}`;
      return `an extra ${formatMoney(extra.amount)} a month from ${when}`;
    });
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Names the extras on the plan a why-sentence picked. */
export function whyWithExtras(why: string, extras: readonly DatedExtra[]): string {
  const phrase = extrasPhrase(extras);
  if (!phrase) return why;
  const secured = " Secured on your home.";
  const tail = why.endsWith(secured) ? secured : "";
  const body = tail ? why.slice(0, -tail.length) : why;
  const stem = body.endsWith(".") ? body.slice(0, -1) : body;
  return `${stem}, including ${phrase}.${tail}`;
}

const CARD_RISK = { none: 0, unsecured: 1, secured: 2 } as const;
const CARD_NEVER = 1_000_000;

function cardMonths(card: ScenarioCard): number {
  return card.spanMonths == null ? CARD_NEVER : card.spanMonths;
}

function bestDisplayed(cards: readonly ScenarioCard[]): ScenarioCard {
  let best = cards[0]!;
  for (const card of cards.slice(1)) {
    const key = [card.interestAmount, card.contractual, CARD_RISK[card.risk]];
    const bestKey = [best.interestAmount, best.contractual, CARD_RISK[best.risk]];
    if (key[0]! < bestKey[0]! || (key[0] === bestKey[0] && (key[1]! < bestKey[1]! || (key[1] === bestKey[1] && key[2]! < bestKey[2]!)))) {
      best = card;
    }
  }
  return best;
}

function soonerFromCards(winner: ScenarioCard, baseline: ScenarioCard, than: string): string {
  const secured = winner.risk === "secured" ? " Secured on your home." : "";
  if (baseline.spanMonths == null && winner.spanMonths != null) {
    const unit = winner.spanMonths === 1 ? "month" : "months";
    return `Debt free in ${winner.spanMonths} ${unit} instead of never.${secured}`;
  }
  const months = cardMonths(baseline) - cardMonths(winner);
  const interest = baseline.interestAmount - winner.interestAmount;
  const unit = months === 1 ? "month" : "months";
  const dollars = Math.round(Math.abs(interest) / 100) * 100;
  const interestText =
    dollars === 0 ? "" : interest > 0 ? ` and ${formatMoney(dollars)} less interest` : ` and ${formatMoney(dollars)} more interest`;
  return `${months} ${unit} sooner${interestText} than ${than}.${secured}`;
}

function tieFromCards(winner: ScenarioCard, other: ScenarioCard): string {
  if (winner.interestAmount < other.interestAmount) return "Tied on time; less interest";
  if (winner.contractual < other.contractual) return "Tied on time; lower monthly payment";
  if (CARD_RISK[winner.risk] < CARD_RISK[other.risk]) return "Tied on time; less risk";
  return "Tied on time, interest, and payment.";
}

function withPaymentRise(why: string, card: ScenarioCard): string {
  if (card.alert === "none") return why;
  const rise = Math.round(card.peakMonthly) - Math.round(card.todayMonthly);
  if (rise <= 0) return why;
  const clause = `but raises the monthly payment by ${formatMoney(rise)} (${formatPercent(card.paymentChangePct)})`;
  if (why.endsWith(".")) return `${why.slice(0, -1)}, ${clause}.`;
  return `${why}, ${clause}.`;
}

/** The fastest listed plan that raises the payment, when one finishes before the suggestion. */
function fasterAlertLine(cards: readonly ScenarioCard[], winner: ScenarioCard): string | null {
  const faster = cards.filter(
    (card) => card.comparable && card.id !== winner.id && card.alert !== "none" && cardMonths(card) < cardMonths(winner),
  );
  if (faster.length === 0) return null;
  const fastest = Math.min(...faster.map(cardMonths));
  const plan = bestDisplayed(faster.filter((card) => cardMonths(card) === fastest));
  const rise = Math.round(plan.peakMonthly) - Math.round(plan.todayMonthly);
  const time = plan.spanMonths == null ? plan.debtFree : formatMonths(plan.spanMonths);
  return `A faster plan (${plan.name}, ${time}) raises the monthly payment by ${formatMoney(rise)} (${formatPercent(plan.paymentChangePct)}).`;
}

function withFasterAlert(why: string, cards: readonly ScenarioCard[], winner: ScenarioCard): string {
  const extra = fasterAlertLine(cards, winner);
  return extra ? `${why} ${extra}` : why;
}

/** Why the suggestion won, using the months and interest printed on those cards. */
export function cardWhy(cards: readonly ScenarioCard[], suggestionId: string): string {
  const winner = cards.find((card) => card.id === suggestionId);
  if (!winner) return "No action needed";
  const ranked = cards.filter(
    (card) =>
      card.comparable &&
      card.alert === "none" &&
      (card.id === winner.id ||
        card.id === "current" ||
        card.id === "avalanche" ||
        card.id === "snowball" ||
        card.origin === "advisor"),
  );
  const others = ranked.filter((card) => card.id !== winner.id);
  const tied = others.filter((card) => cardMonths(card) - cardMonths(winner) <= TIE_WINDOW_MONTHS);
  if (winner.id === "current" && tied.length === 0) return withFasterAlert("No action needed", cards, winner);
  if (tied.length > 0) return withFasterAlert(tieFromCards(winner, bestDisplayed(tied)), cards, winner);
  let baseline = cards.find((card) => card.id === "current");
  let than = "the current path";
  if (winner.risk !== "none") {
    const smarter = cards.filter((card) => (card.id === "avalanche" || card.id === "snowball") && card.alert === "none");
    if (smarter.length > 0) {
      baseline = bestDisplayed(smarter);
      than = "paying smarter without a loan";
    }
  }
  if (!baseline || baseline.id === winner.id) return withFasterAlert("No action needed", cards, winner);
  return withFasterAlert(
    withPaymentRise(whyWithExtras(soonerFromCards(winner, baseline, than), winner.extraPayments), winner),
    cards,
    winner,
  );
}

/** Built-in names, product names, and the case's other scenarios. Matching ignores case. */
export function reservedPlanNames(
  choices: readonly { label: string; product: string }[],
  scenarios: readonly { scenario_id: string; name: string }[],
  editingId: string | null,
): string[] {
  const names = ["Current path", "Avalanche", "Snowball"];
  for (const choice of choices) names.push(choice.label, choice.product);
  for (const scenario of scenarios) {
    if (scenario.scenario_id !== editingId) names.push(scenario.name);
  }
  return names;
}

export function scenarioNameError(name: string, taken: readonly string[]): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return NAME_REQUIRED;
  if (taken.some((row) => row.trim().toLowerCase() === key)) return NAME_TAKEN;
  return null;
}

export type ProductGap = { product: string; reason: string };

export type OfferChoice = {
  id: string;
  product: string;
  termMonths: number;
  propertyId: string | null;
  rate: number;
  label: string;
  amount: number;
  debtIds: string[];
  minimum: number;
};

export type MovableDebt = {
  debtId: string;
  name: string;
  rate: number;
  balance: number;
  balanceText: string;
  propertyId: string | null;
  mandatory: boolean;
};

export type CardOrigin = "today" | "builtin" | "advisor";

export type ScenarioCard = {
  id: string;
  kind: "builtin" | "advisor";
  origin: CardOrigin;
  /** The nightly pipeline's best plan, recalculated on the case inputs. Exactly one card. */
  nightly: boolean;
  /** An advisor scenario with the same inputs was folded into this column. */
  advisorCopy: boolean;
  /** This column is the case's saved recommendation. */
  previouslyRecommended: boolean;
  /** Rule 6 across every scenario in the case, including ones the advisor built. */
  suggested: boolean;
  /** Same key means the same strategy, loan, debts and extras. */
  inputKey: string;
  /** A loan that moves no debt cannot be suggested or compared. */
  comparable: boolean;
  includesExtras: boolean;
  extraPayments: DatedExtra[];
  /** Debt-free span printed on the card. Null when the plan never finishes. */
  spanMonths: number | null;
  /** Total interest printed on the card, in whole dollars. */
  interestAmount: number;
  todayMonthly: number;
  /** Highest monthly payment, the figure the alert uses. */
  peakMonthly: number;
  /** Contractual payment. Ties within a month go to the lower one. */
  contractual: number;
  paymentChangePct: number;
  risk: PlanRisk;
  /** Current path can be recommended only when nothing else beats it. */
  recommendable: boolean;
  badges: string[];
  name: string;
  debtFree: string;
  interest: string;
  monthsSaved: string;
  interestSaved: string;
  /** "None", or product, term, amount, and whether the loan is secured on the home. */
  loan: string;
  /** Debt-free month for each debt this plan includes. Moved debts say "Paid by new loan". */
  debtWhen: Record<string, string>;
  /** Payoff month index for each debt that finishes, including the new loan. */
  payoffMonths: Record<string, number>;
  /** "New loan · HELOAN Yellow · 7.875%" when this plan adds a loan. */
  loanDebt: string | null;
  /** Plain lines for each payment change, in date order. */
  moneyGoes: string[];
  /** Who gets money left after each debt's own payment. */
  spare: string;
  monthly: string;
  alert: PaymentAlert;
  alertLabel: string;
  note: string | null;
  labels: string[];
  scenarioId: string | null;
};

export type WorkspaceModel = {
  householdId: string;
  name: string;
  cards: ScenarioCard[];
  /** Every debt on the household, including ones plans leave out. */
  debtRows: DebtRow[];
  gaps: ProductGap[];
  choices: OfferChoice[];
  debts: MovableDebt[];
  properties: Property[];
  suggestionId: string;
  suggestionName: string;
  suggestionWhy: string;
  /** Set when today's path never finishes, for the months and interest saved tooltip. */
  comparableNote: string | null;
};

export type DebtRow = {
  debtId: string;
  name: string;
  /** "28.07%". */
  rate: string;
  included: boolean;
  /** Most recent edit of a value shown for this debt, one line each. */
  edits: string[];
  /** True when an edit cleared a flag that the source data raised. */
  resolved: boolean;
  /** The other copy of this debt was excluded, so the row stands for both. */
  duplicateExcluded: boolean;
};

export type DraftExtra = {
  id: string | null;
  type: ExtraPayment["type"];
  amount: number;
  startMonth: string;
};

export type ScenarioDraft = {
  name: string;
  strategy: "avalanche" | "snowball";
  loanSource: Scenario["loan_source"];
  product: string | null;
  termMonths: number | null;
  loanAmount: number;
  loanRate: number | null;
  debtIds: string[];
  extras: DraftExtra[];
};

export type DraftPreview = {
  debtFree: string;
  interest: string;
  monthly: string;
  alert: PaymentAlert;
  alertLabel: string;
  note: string | null;
  labels: string[];
  months: number | null;
  interestAmount: number;
};

function splitIds(value: string | null): string[] {
  return (value ?? "").split(";").filter((id) => id !== "");
}

function datedExtras(scenario: Scenario, payments: readonly ExtraPayment[]): DatedExtra[] {
  const ids = new Set(splitIds(scenario.extra_payment_ids));
  return payments
    .filter((row) => ids.has(row.extra_id))
    .map((row) => ({ type: row.type, amount: row.amount, startMonth: row.start_month }));
}

function blended(parts: readonly { balance: number; rate: number }[]): number {
  const total = parts.reduce((sum, part) => sum + part.balance, 0);
  if (!total) return 0;
  return parts.reduce((sum, part) => sum + part.balance * part.rate, 0) / total;
}

function termLabel(months: number): string {
  if (months % 12 === 0) return `${months / 12}-year`;
  return `${months} months`;
}

function monthCount(months: number | null): string {
  if (months == null) return NEVER_NOTE;
  return `${months} ${months === 1 ? "month" : "months"}`;
}

/** Months saved against the frozen current path. A negative span is "6 months later". */
export function savingsText(current: number | null, months: number | null): string {
  if (current == null || months == null) return NOT_COMPARABLE;
  return signedMonthsSaved(current - months);
}

/** Today, then Built-in, then Built by you. A plan gets the first one that applies. */
export function planSource(card: Pick<ScenarioCard, "origin">): (typeof SOURCE_LABELS)[number] {
  if (card.origin === "today") return "Today";
  if (card.origin === "builtin") return "Built-in";
  return "Built by you";
}

/** The source label, then the badges that sit under the plan name. */
export function sourceBadges(
  card: Pick<ScenarioCard, "origin" | "nightly" | "suggested" | "previouslyRecommended" | "includesExtras">,
): string[] {
  const badges: string[] = [planSource(card)];
  if (card.nightly) badges.push("Nightly best");
  if (card.suggested) badges.push("Suggested");
  if (card.previouslyRecommended) badges.push("Previously recommended");
  if (card.includesExtras) badges.push(INCLUDES_EXTRAS);
  return badges;
}

/** Nightly best, Suggested, Previously recommended, and the extras label. */
export function headerBadges(badges: readonly string[]): string[] {
  return badges.filter((badge) => (HEADER_MARKS as readonly string[]).includes(badge) || badge === INCLUDES_EXTRAS);
}

/**
 * The name of a plan that already uses these inputs, or null when this draft is new.
 * A new extra payment is a different plan. Editing the plan itself is allowed.
 */
export function identicalPlan(
  draft: ScenarioDraft,
  cards: readonly Pick<ScenarioCard, "inputKey" | "name" | "scenarioId">[],
  editingId: string | null,
): string | null {
  if (draft.extras.some((extra) => extra.id == null)) return null;
  const key = planKey({
    strategy: draft.strategy,
    loanSource: draft.loanSource,
    product: draft.loanSource === "product" ? draft.product : null,
    termMonths: draft.loanSource === "none" ? null : draft.termMonths,
    amount: draft.loanSource === "none" ? 0 : draft.loanAmount,
    rate: draft.loanSource === "none" ? null : draft.loanRate,
    debtIds: draft.loanSource === "none" ? [] : draft.debtIds,
    extraIds: draft.extras.flatMap((extra) => (extra.id ? [extra.id] : [])),
  });
  const match = cards.find((card) => {
    if (card.inputKey !== key) return false;
    return editingId == null || card.scenarioId !== editingId;
  });
  return match?.name ?? null;
}

/** Interest saved against the frozen current path. A higher total is "Costs $2,177 more". */
export function interestSavedText(
  currentMonths: number | null,
  currentInterest: number,
  months: number | null,
  interest: number,
): string {
  if (currentMonths == null || months == null) return NOT_COMPARABLE;
  return signedInterestSaved(Math.round(currentInterest) - Math.round(interest));
}

function asPaymentDebt(debt: {
  debt_id: string;
  debt_name: string;
  monthly_payment: number;
  rate: number;
  balance: number;
}): PaymentDebt {
  return {
    id: debt.debt_id,
    name: debt.debt_name,
    payment: debt.monthly_payment,
    rate: debt.rate,
    balance: debt.balance,
  };
}

/** Where each payment moves, from a fresh run of this plan's schedule. */
function moneyGoesFor(
  debts: readonly {
    debt_id: string;
    debt_name: string;
    monthly_payment: number;
    rate: number;
    balance: number;
  }[],
  strategy: Strategy,
  budget: number,
  paidOff: readonly {
    debt_id: string;
    debt_name: string;
    monthly_payment: number;
    rate: number;
    balance: number;
  }[] = [],
  loan: { amount: number; rate: number; term: number } | null = null,
  extras: readonly ExtraInput[] = [],
  schedule?: ReturnType<typeof simulate>["schedule"],
): string[] {
  const moved = new Set(paidOff.map((debt) => debt.debt_id));
  const remaining = debts.filter((debt) => debt.monthly_payment > 0 && !moved.has(debt.debt_id));
  const facts = remaining.map(asPaymentDebt);
  let loanStart: LoanStart | null = null;
  let loanPayment = 0;
  let loanBalance = 0;
  let loanRate = 0;
  if (loan && loan.amount > 0 && loan.term > 0) {
    loanBalance = loan.amount;
    loanRate = loan.rate;
    loanPayment = amortise(loan.amount, loan.rate, loan.term);
    const payment = pythonRound(loanPayment);
    facts.push({
      id: "NEW_LOAN",
      name: "New loan",
      payment,
      rate: loan.rate,
      balance: loan.amount,
    });
    loanStart = { amount: loan.amount, payment };
  }
  const rows =
    schedule ??
    simulate(
      [
        ...remaining.map((debt) => ({
          id: debt.debt_id,
          balance: debt.balance,
          rate: debt.rate,
          payment: debt.monthly_payment,
        })),
        ...(loanStart ? [{ id: "NEW_LOAN", balance: loanBalance, rate: loanRate, payment: loanPayment }] : []),
      ],
      strategy,
      Math.max(budget, remaining.reduce((sum, debt) => sum + debt.monthly_payment, 0) + loanPayment),
      extras,
    ).schedule;
  return paymentEventLines({
    schedule: rows,
    debts: facts,
    paidOff: paidOff.map(asPaymentDebt),
    loan: loanStart,
    strategy,
    extras,
  });
}

function debtWhen(
  debtIds: readonly string[],
  payoffMonths: Readonly<Record<string, number>>,
  moved: readonly string[],
  hasLoan: boolean,
): { when: Record<string, string>; months: Record<string, number> } {
  const movedSet = new Set(moved);
  const when: Record<string, string> = {};
  const months: Record<string, number> = {};
  for (const id of debtIds) {
    const month = payoffMonths[id];
    if (movedSet.has(id)) when[id] = "Paid by new loan";
    else if (month != null) {
      when[id] = planDate(month);
      months[id] = month;
    } else when[id] = "Never";
  }
  if (hasLoan) {
    const month = payoffMonths.NEW_LOAN;
    if (month != null) {
      when.NEW_LOAN = planDate(month);
      months.NEW_LOAN = month;
    } else when.NEW_LOAN = "Never";
  }
  return { when, months };
}

function debtFields(
  debtIds: readonly string[],
  payoffMonths: Readonly<Record<string, number>>,
  moved: readonly string[],
  hasLoan: boolean,
): { debtWhen: Record<string, string>; payoffMonths: Record<string, number> } {
  const schedule = debtWhen(debtIds, payoffMonths, moved, hasLoan);
  return { debtWhen: schedule.when, payoffMonths: schedule.months };
}

/** Catalogue and custom loans share this row. The product is "Custom loan" when the advisor set the terms. */
export function loanDebtLabel(product: string | null, rate: number | null): string | null {
  if (rate == null) return null;
  return `New loan · ${product ?? "Custom loan"} · ${formatRate(rate)}`;
}

function loanLine(input: {
  source: Scenario["loan_source"];
  product: string | null;
  termMonths: number | null;
  amount: number;
  secured: boolean;
}): string {
  if (input.source === "none" || input.amount <= 0) return "None";
  const name = input.product ?? "Custom loan";
  const term = input.termMonths == null ? "—" : termLabel(input.termMonths);
  const security = input.secured ? "Secured on the home" : "Not secured";
  return `${name} · ${term} · ${formatMoney(input.amount)} · ${security}`;
}

export function alertLabel(alert: PaymentAlert, from: number, to: number, percent: number): string {
  if (alert === "none") return "None";
  return paymentAlertText(from, to, percent);
}

function lowersBlend(state: WorkingHousehold, amount: number, rate: number, debtIds: readonly string[]): boolean {
  if (amount <= 0) return true;
  const valid = validDebts(state.debts);
  const moved = new Set(debtIds);
  const base = valid.map((debt) => ({ balance: debt.balance, rate: debt.rate }));
  const remaining = valid
    .filter((debt) => !moved.has(debt.debt_id))
    .map((debt) => ({ balance: debt.balance, rate: debt.rate }));
  return blended([...remaining, { balance: amount, rate }]) < blended(base);
}

export function loanLabels(
  state: WorkingHousehold,
  source: Scenario["loan_source"],
  product: string | null,
  amount: number,
  rate: number | null,
  debtIds: readonly string[],
): string[] {
  if (source === "none" || amount <= 0 || rate == null) return [];
  const labels: string[] = [];
  const minimum = product ? (MINIMUM[product] ?? 0) : 0;
  if (source === "product" && amount < minimum) labels.push(BELOW_MINIMUM);
  if (!lowersBlend(state, amount, rate, debtIds)) labels.push(WONT_SAVE);
  if (product?.startsWith("HELOAN") && householdFico(state.members).defaulted) labels.push("estimated");
  return labels;
}

function cardFromNumbers(input: {
  id: string;
  kind: ScenarioCard["kind"];
  origin: CardOrigin;
  name: string;
  months: number | null;
  interest: number;
  monthly: number;
  contractual: number;
  alert: PaymentAlert;
  percent: number;
  today: number;
  currentMonths: number | null;
  currentInterest: number;
  inputKey: string;
  labels: string[];
  scenarioId: string | null;
  loan: string;
  debtWhen: Record<string, string>;
  payoffMonths?: Record<string, number>;
  loanDebt?: string | null;
  moneyGoes?: string[];
  spare?: string;
  monthlyText?: string;
  includesExtras?: boolean;
  comparable?: boolean;
  extraPayments?: DatedExtra[];
  warning?: string | null;
  risk?: PlanRisk;
}): ScenarioCard {
  const unfinished = input.months == null;
  return {
    id: input.id,
    kind: input.kind,
    origin: input.origin,
    nightly: false,
    advisorCopy: false,
    previouslyRecommended: false,
    suggested: false,
    inputKey: input.inputKey,
    comparable: input.comparable ?? true,
    includesExtras: input.includesExtras ?? false,
    extraPayments: input.extraPayments ?? [],
    spanMonths: input.months,
    interestAmount: Math.round(input.interest),
    todayMonthly: input.today,
    peakMonthly: input.monthly,
    contractual: input.contractual,
    paymentChangePct: input.percent,
    risk: input.risk ?? "none",
    recommendable: input.origin !== "today",
    badges: [],
    name: input.name,
    debtFree: monthCount(input.months),
    interest: unfinished ? NOT_COMPARABLE : formatMoney(input.interest),
    monthsSaved: savingsText(input.currentMonths, input.months),
    interestSaved: interestSavedText(
      input.currentMonths,
      input.currentInterest,
      input.months,
      input.interest,
    ),
    loan: input.loan,
    debtWhen: input.debtWhen,
    payoffMonths: input.payoffMonths ?? {},
    loanDebt: input.loanDebt ?? null,
    moneyGoes: input.moneyGoes ?? [],
    spare: input.spare ?? spareMoney("current", []),
    monthly: input.monthlyText ?? formatMoney(input.monthly),
    alert: input.alert,
    alertLabel: alertLabel(input.alert, input.today, input.monthly, input.percent),
    note: input.warning ?? (unfinished ? NEVER_NOTE : null),
    labels: input.labels,
    scenarioId: input.scenarioId,
  };
}

function scenarioRisk(scenario: Scenario): PlanRisk {
  if (scenario.loan_source === "none") return "none";
  if (scenario.product?.startsWith("HELOAN")) return "secured";
  return "unsecured";
}

function nightlyCardId(bestPlan: string, cards: readonly ScenarioCard[]): string | null {
  if (bestPlan === "Current path") return cards.some((card) => card.id === "current") ? "current" : null;
  if (bestPlan === "Avalanche") return cards.some((card) => card.id === "avalanche") ? "avalanche" : null;
  if (bestPlan === "Snowball") return cards.some((card) => card.id === "snowball") ? "snowball" : null;
  const match = /^(.*) (\d+)m$/.exec(bestPlan);
  if (!match) return null;
  const prefix = `offer:${match[1]}:${match[2]}:`;
  return cards.find((card) => card.id.startsWith(prefix))?.id ?? null;
}

/** Rule 6: the usual order, and only plans whose payment alert is none. */
function suggestedCard(cards: readonly ScenarioCard[]): ScenarioCard | undefined {
  const calm = cards.filter((card) => card.comparable && card.alert === "none");
  if (calm.length === 0) return cards.find((card) => card.comparable) ?? cards[0];
  const fastest = Math.min(...calm.map(cardMonths));
  const tied = calm.filter((card) => cardMonths(card) - fastest <= TIE_WINDOW_MONTHS);
  return bestDisplayed(tied);
}

/** Mark the nightly plan and rank the case. Every number stays on the case inputs. */
function settleCards(
  householdId: string,
  cards: ScenarioCard[],
): { suggestionId: string; suggestionName: string; suggestionWhy: string } {
  const suggestionId = suggestedCard(cards)?.id ?? cards[0]?.id ?? "current";
  for (const card of cards) {
    card.suggested = card.id === suggestionId;
    card.recommendable = card.comparable && (card.origin !== "today" || card.suggested);
  }

  const nightly = pipelineResults.find((row) => row.household_id === householdId);
  const nightlyId = nightly ? nightlyCardId(nightly.best_plan, cards) : null;
  const nightlyCard = cards.find((card) => card.id === nightlyId);
  if (nightlyCard) nightlyCard.nightly = true;
  for (const card of cards) card.badges = sourceBadges(card);
  const winner = cards.find((card) => card.id === suggestionId);
  return {
    suggestionId,
    suggestionName: winner?.name ?? "",
    suggestionWhy: "",
  };
}

function offerChoices(offers: readonly BuiltOffer[], properties: readonly Property[]): OfferChoice[] {
  const addresses = new Map(properties.map((property) => [property.property_id, property.address]));
  const counts = new Map<string, number>();
  for (const offer of offers) {
    const key = `${offer.product}:${offer.term_months}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return offers.map((offer) => {
    const key = `${offer.product}:${offer.term_months}`;
    const place =
      (counts.get(key) ?? 0) > 1 && offer.property_id
        ? ` · ${addresses.get(offer.property_id) ?? offer.property_id}`
        : "";
    return {
      id: `offer:${offer.product}:${offer.term_months}:${offer.property_id ?? "none"}`,
      product: offer.product,
      termMonths: offer.term_months,
      propertyId: offer.property_id,
      rate: offer.rate,
      label: `${offer.product} ${termLabel(offer.term_months)}${place}`,
      amount: offer.loan_amount,
      debtIds: splitIds(offer.debts_paid_off),
      minimum: MINIMUM[offer.product] ?? 0,
    };
  });
}

function homeEquityReason(state: WorkingHousehold, product: "HELOAN Yellow" | "HELOAN Pink"): string {
  const excluded = product === "HELOAN Yellow" ? new Set(["TX"]) : new Set(["TX", "VT", "IA"]);
  if (excluded.has(state.household.home_state)) return `Not offered in ${state.household.home_state}.`;
  const fico = householdFico(state.members).fico;
  const bands = product === "HELOAN Yellow" ? YELLOW : PINK;
  const band = bands.find((row) => fico >= row.min);
  if (!band) return `FICO ${fico} is below the minimum for ${product}.`;
  if (state.properties.length === 0) return "No property on file.";

  const rows = loanProducts.filter((row) => row.product === product);
  const valid = validDebts(state.debts);
  const unsecured = valid
    .filter((debt) => !debt.property_id && !NOT_UNSECURED.has(debt.debt_type))
    .slice()
    .sort((a, b) => b.rate - a.rate);
  const base = valid.map((debt) => ({ id: debt.debt_id, balance: debt.balance, rate: debt.rate }));
  let sawMortgage = false;
  let sawEquity = false;
  let anyPlain = false;
  let bestAmount = 0;
  let blendBlocked = false;
  const minimum = MINIMUM[product] ?? 0;

  for (const property of state.properties) {
    const onProperty = state.debts.filter((debt) => debt.property_id === property.property_id);
    if (onProperty.some((debt) => debt.debt_type === "Reverse mortgage")) continue;
    anyPlain = true;
    const mortgages = onProperty.filter((debt) => debt.debt_type === "Mortgage");
    if (mortgages.length === 0) continue;
    sawMortgage = true;
    const cltv = property.property_type === "Residence" ? band.residence : band.investment;
    const available = property.value * cltv - mortgages.reduce((sum, debt) => sum + debt.balance, 0);
    const cap =
      product === "HELOAN Yellow"
        ? property.property_type === "Investment" || fico < 680
          ? 350_000
          : 500_000
        : 750_000;
    const limit = Math.min(available, cap);
    if (limit <= 0) continue;
    sawEquity = true;
    const mandatory = onProperty.filter((debt) => debt.debt_type === "Home equity loan");
    for (const row of rows) {
      let amount = mandatory.reduce((sum, debt) => sum + debt.balance, 0);
      if (amount > limit) continue;
      const chosen = [...mandatory];
      for (const debt of unsecured) {
        if (debt.rate > row.rate && amount + debt.balance <= limit) {
          chosen.push(debt);
          amount += debt.balance;
        }
      }
      if (amount > bestAmount) bestAmount = amount;
      if (amount < minimum || chosen.length === 0) continue;
      const moved = new Set(chosen.map((debt) => debt.debt_id));
      const remaining = base.filter((debt) => !moved.has(debt.id));
      const oldBlend = blended(base);
      const nextBlend = blended([...remaining, { balance: amount, rate: row.rate }]);
      if (nextBlend >= oldBlend) blendBlocked = true;
    }
  }

  if (!sawMortgage && !anyPlain) return "A reverse mortgage is on the property.";
  if (!sawMortgage) return "No mortgage is linked to a property.";
  if (!sawEquity) return "Not enough equity.";
  if (blendBlocked && bestAmount >= minimum) return "A loan would not lower the blended rate.";
  if (bestAmount > 0 && bestAmount < minimum) return `Below the ${formatMoney(minimum)} minimum.`;
  return "No debt has a rate high enough to refinance.";
}

export function productGaps(state: WorkingHousehold, offers: readonly BuiltOffer[]): ProductGap[] {
  const gaps: ProductGap[] = [];
  if (!offers.some((offer) => offer.product === "FastApp")) {
    const reason = !state.fastAppApproved
      ? "Not on the FastApp list."
      : (describeFastAppMiss(fastAppMiss(state)) ?? "No FastApp offer.");
    gaps.push({ product: "FastApp", reason });
  }
  for (const product of ["HELOAN Yellow", "HELOAN Pink"] as const) {
    if (offers.some((offer) => offer.product === product)) continue;
    gaps.push({ product, reason: homeEquityReason(state, product) });
  }
  return gaps;
}

export function movableDebts(state: WorkingHousehold, propertyId: string | null): MovableDebt[] {
  const unsecured = validDebts(state.debts)
    .filter((debt) => !debt.property_id && !NOT_UNSECURED.has(debt.debt_type))
    .slice()
    .sort((a, b) => b.rate - a.rate);
  const equity = validDebts(state.debts).filter(
    (debt) => debt.debt_type === "Home equity loan" && (propertyId == null || debt.property_id === propertyId),
  );
  return [...equity, ...unsecured].map((debt) => ({
    debtId: debt.debt_id,
    name: debt.debt_name,
    rate: debt.rate,
    balance: debt.balance,
    balanceText: formatMoney(debt.balance),
    propertyId: debt.property_id,
    mandatory: debt.debt_type === "Home equity loan",
  }));
}

function toScenario(caseId: string, householdId: string, draft: ScenarioDraft, extraIds: string): Scenario {
  return {
    scenario_id: "draft",
    case_id: caseId,
    household_id: householdId,
    name: draft.name,
    strategy: draft.strategy,
    loan_source: draft.loanSource,
    product: draft.loanSource === "product" ? draft.product : null,
    term_months: draft.loanSource === "none" ? null : draft.termMonths,
    loan_amount: draft.loanSource === "none" ? 0 : draft.loanAmount,
    loan_rate: draft.loanSource === "none" ? null : draft.loanRate,
    debts_paid_off: draft.loanSource === "none" ? null : draft.debtIds.join(";") || null,
    extra_payment_ids: extraIds || null,
    created_by: "",
    is_recommended: false,
    advisor_reason: null,
  };
}

/** Live result for the builder. Unsaved extras are included only in this run. */
export function previewDraft(
  state: WorkingHousehold,
  caseId: string,
  caseState: CaseState,
  draft: ScenarioDraft,
): DraftPreview {
  const tempExtras: ExtraPayment[] = draft.extras.map((extra, index) => ({
    extra_id: extra.id ?? `draft-${index}`,
    case_id: caseId,
    household_id: state.household.household_id,
    type: extra.type,
    amount: extra.amount,
    start_month: extra.startMonth,
    end_month: null,
    reason: "",
  }));
  const scenario = toScenario(
    caseId,
    state.household.household_id,
    draft,
    tempExtras.map((extra) => extra.extra_id).join(";"),
  );
  const replaced = new Set(tempExtras.map((extra) => extra.extra_id));
  const result = runScenario(
    state,
    {
      ...caseState,
      extraPayments: [
        ...caseState.extraPayments.filter((extra) => !replaced.has(extra.extra_id)),
        ...tempExtras,
      ],
    },
    scenario,
  );
  const labels = loanLabels(
    state,
    draft.loanSource,
    draft.product,
    draft.loanSource === "none" ? 0 : draft.loanAmount,
    draft.loanRate,
    draft.debtIds,
  );
  const invalidLoan = draft.loanSource !== "none" && draft.debtIds.length === 0;
  const payment = describePayment(result.monthly, draft.extras);
  const rise = result.todayMonthly ? payment.peak / result.todayMonthly - 1 : 0;
  const alert = paymentAlert(payment.peak, result.todayMonthly);
  const percent = pythonRound(rise * 100, 1);
  if (draft.extras.length > 0) labels.push(INCLUDES_EXTRAS);
  return {
    debtFree: result.months == null ? NEVER_NOTE : monthCount(result.months),
    interest: formatMoney(result.totalInterest),
    monthly: payment.display,
    alert,
    alertLabel: alertLabel(alert, result.todayMonthly, payment.peak, percent),
    note: invalidLoan ? LOAN_MOVES_NOTHING : result.months == null ? NEVER_NOTE : null,
    labels,
    months: result.months,
    interestAmount: result.totalInterest,
  };
}

const NO_LOAN_KEY = {
  loanSource: "none",
  product: null,
  termMonths: null,
  amount: 0,
  rate: null,
  debtIds: [] as string[],
  extraIds: [] as string[],
};

export function assembleWorkspace(
  inputs: CaseInputs,
  scenarios: readonly Scenario[],
  caseState: CaseState,
): WorkspaceModel {
  const state = inputs.planned;
  const plans = inputs.plans;
  const edited = inputs.edited;
  const offers = buildOffers(state);
  const choices = offerChoices(offers, state.properties);
  const scoreEstimated = householdFico(state.members).defaulted;
  const currentMonths = plans.current.months;
  const currentInterest = plans.current.interest;
  const valid = validDebts(state.debts);
  const includedIds = valid.map((debt) => debt.debt_id);
  const pay = todayPayment(state.debts);
  const openFacts = valid.map((debt) => ({ name: debt.debt_name, rate: debt.rate, balance: debt.balance }));
  const currentPay = describeCurrentPayment(
    valid.map((debt) => ({ id: debt.debt_id, payment: debt.monthly_payment })),
    plans.current.payoffMonths,
    plans.current.months,
  );
  const noLoan = "None";
  const cards: ScenarioCard[] = [
    cardFromNumbers({
      id: "current",
      kind: "builtin",
      origin: "today",
      name: editedName("Current path", edited),
      months: plans.current.months,
      interest: plans.current.interest,
      monthly: pay,
      contractual: pay,
      monthlyText: currentPay.display,
      alert: "none",
      percent: 0,
      today: pay,
      currentMonths,
      currentInterest,
      inputKey: planKey({ strategy: "current", ...NO_LOAN_KEY }),
      labels: [],
      scenarioId: null,
      loan: noLoan,
      ...debtFields(includedIds, plans.current.payoffMonths, [], false),
      moneyGoes: moneyGoesFor(valid, "current", pay),
      spare: spareMoney("current", []),
    }),
    cardFromNumbers({
      id: "avalanche",
      kind: "builtin",
      origin: "builtin",
      name: editedName("Avalanche", edited),
      months: plans.avalanche.months,
      interest: plans.avalanche.interest,
      monthly: pay,
      contractual: pay,
      alert: "none",
      percent: 0,
      today: pay,
      currentMonths,
      currentInterest,
      inputKey: planKey({ strategy: "avalanche", ...NO_LOAN_KEY }),
      labels: [],
      scenarioId: null,
      loan: noLoan,
      ...debtFields(includedIds, plans.avalanche.payoffMonths, [], false),
      moneyGoes: moneyGoesFor(valid, "avalanche", pay),
      spare: spareMoney("avalanche", openFacts),
    }),
    cardFromNumbers({
      id: "snowball",
      kind: "builtin",
      origin: "builtin",
      name: editedName("Snowball", edited),
      months: plans.snowball.months,
      interest: plans.snowball.interest,
      monthly: pay,
      contractual: pay,
      alert: "none",
      percent: 0,
      today: pay,
      currentMonths,
      currentInterest,
      inputKey: planKey({ strategy: "snowball", ...NO_LOAN_KEY }),
      labels: [],
      scenarioId: null,
      loan: noLoan,
      ...debtFields(includedIds, plans.snowball.payoffMonths, [], false),
      moneyGoes: moneyGoesFor(valid, "snowball", pay),
      spare: spareMoney("snowball", openFacts),
    }),
  ];

  for (const choice of choices) {
    const offer = offers.find(
      (row) =>
        row.product === choice.product &&
        row.term_months === choice.termMonths &&
        (row.property_id ?? "none") === (choice.propertyId ?? "none"),
    );
    if (!offer) continue;
    cards.push(
      cardFromNumbers({
        id: choice.id,
        kind: "builtin",
        origin: "builtin",
        name: editedName(choice.label, edited),
        months: offer.months,
        interest: offer.total_interest,
        monthly: Math.max(pay, offer.contractual_monthly),
        contractual: offer.contractual_monthly,
        alert: offer.payment_alert,
        percent: offer.payment_change_pct,
        today: pay,
        currentMonths,
        currentInterest,
        inputKey: planKey({
          strategy: "avalanche",
          loanSource: "product",
          product: choice.product,
          termMonths: choice.termMonths,
          amount: choice.amount,
          rate: choice.rate,
          debtIds: choice.debtIds,
          extraIds: [],
        }),
        labels: scoreEstimated && choice.product.startsWith("HELOAN") ? ["estimated"] : [],
        scenarioId: null,
        loan: loanLine({
          source: "product",
          product: choice.product,
          termMonths: choice.termMonths,
          amount: choice.amount,
          secured: choice.product.startsWith("HELOAN"),
        }),
        ...debtFields(includedIds, offer.payoffMonths, choice.debtIds, true),
        loanDebt: loanDebtLabel(choice.product, choice.rate),
        moneyGoes: moneyGoesFor(
          valid,
          "avalanche",
          pay,
          choice.debtIds.flatMap((id) => {
            const debt = valid.find((row) => row.debt_id === id);
            return debt ? [debt] : [];
          }),
          { amount: choice.amount, rate: choice.rate, term: choice.termMonths },
        ),
        spare: spareMoney("avalanche", [
          ...valid
            .filter((debt) => !choice.debtIds.includes(debt.debt_id))
            .map((debt) => ({ name: debt.debt_name, rate: debt.rate, balance: debt.balance })),
          { name: "New loan", rate: choice.rate, balance: choice.amount },
        ]),
        risk: offer.security,
      }),
    );
  }

  for (const scenario of scenarios) {
    const result = runScenario(state, caseState, scenario);
    const moved = splitIds(scenario.debts_paid_off);
    const invalidLoan = scenario.loan_source !== "none" && moved.length === 0;
    const dated = datedExtras(scenario, caseState.extraPayments);
    const payment = describePayment(result.monthly, dated);
    const rise = result.todayMonthly ? payment.peak / result.todayMonthly - 1 : 0;
    const alert = paymentAlert(payment.peak, result.todayMonthly);
    cards.push(
      cardFromNumbers({
        id: scenario.scenario_id,
        kind: "advisor",
        origin: "advisor",
        name: editedName(scenario.name, edited),
        months: result.months,
        interest: result.totalInterest,
        monthly: payment.peak,
        contractual: result.contractualMonthly,
        monthlyText:
          scenario.strategy === "current"
            ? describeCurrentPayment(
                valid
                  .filter((debt) => !moved.includes(debt.debt_id))
                  .map((debt) => ({ id: debt.debt_id, payment: debt.monthly_payment })),
                result.payoffMonths,
                result.months,
              ).display
            : payment.display,
        alert,
        percent: pythonRound(rise * 100, 1),
        today: result.todayMonthly,
        currentMonths,
        currentInterest,
        inputKey: planKey({
          strategy: scenario.strategy,
          loanSource: scenario.loan_source,
          product: scenario.product,
          termMonths: scenario.term_months,
          amount: scenario.loan_amount,
          rate: scenario.loan_rate,
          debtIds: moved,
          extraIds: splitIds(scenario.extra_payment_ids),
        }),
        labels: [
          ...(invalidLoan ? [LOAN_MOVES_NOTHING] : []),
          ...loanLabels(
            state,
            scenario.loan_source,
            scenario.product,
            scenario.loan_amount,
            scenario.loan_rate,
            moved,
          ),
        ],
        scenarioId: scenario.scenario_id,
        loan: loanLine({
          source: scenario.loan_source,
          product: scenario.product,
          termMonths: scenario.term_months,
          amount: scenario.loan_amount,
          secured: scenario.product?.startsWith("HELOAN") ?? false,
        }),
        ...debtFields(includedIds, result.payoffMonths, moved, scenario.loan_amount > 0 && scenario.loan_rate != null),
        loanDebt:
          scenario.loan_amount > 0 ? loanDebtLabel(scenario.product, scenario.loan_rate) : null,
        spare: spareMoney(
          scenario.strategy,
          scenario.strategy === "current"
            ? []
            : [
                ...valid
                  .filter((debt) => !moved.includes(debt.debt_id))
                  .map((debt) => ({ name: debt.debt_name, rate: debt.rate, balance: debt.balance })),
                ...(scenario.loan_amount > 0 && scenario.loan_rate != null
                  ? [{ name: "New loan", rate: scenario.loan_rate, balance: scenario.loan_amount }]
                  : []),
              ],
        ),
        moneyGoes: moneyGoesFor(
          valid,
          scenario.strategy,
          result.todayMonthly,
          moved.flatMap((id) => {
            const debt = valid.find((row) => row.debt_id === id);
            return debt ? [debt] : [];
          }),
          scenario.loan_amount > 0 && scenario.loan_rate != null && scenario.term_months != null
            ? { amount: scenario.loan_amount, rate: scenario.loan_rate, term: scenario.term_months }
            : null,
          caseState.extraPayments
            .filter((extra) => splitIds(scenario.extra_payment_ids).includes(extra.extra_id))
            .map((extra) => ({
              type: extra.type,
              amount: extra.amount,
              startIndex: monthIndex(extra.start_month),
              endIndex: extra.end_month ? monthIndex(extra.end_month) : null,
            })),
          result.schedule,
        ),
        includesExtras: dated.length > 0,
        comparable: !invalidLoan,
        extraPayments: dated,
        warning: invalidLoan ? LOAN_MOVES_NOTHING : null,
        risk: scenarioRisk(scenario),
      }),
    );
  }

  const settled = settleCards(state.household.household_id, cards);
  const shown = mergeIdentical(cards, settled.suggestionId);
  return {
    householdId: state.household.household_id,
    name: state.household.household_name,
    cards: shown.cards,
    debtRows: [],
    gaps: productGaps(state, offers),
    choices,
    debts: movableDebts(state, null),
    properties: state.properties,
    suggestionId: shown.suggestionId,
    suggestionName: shown.suggestionName || settled.suggestionName,
    suggestionWhy: cardWhy(shown.cards, shown.suggestionId),
    comparableNote: comparableNote(inputs),
  };
}

function mergeIdentical(
  cards: ScenarioCard[],
  suggestionId: string,
): { cards: ScenarioCard[]; suggestionId: string; suggestionName: string } {
  const groups = new Map<string, ScenarioCard[]>();
  for (const card of cards) {
    const list = groups.get(card.inputKey);
    if (list) list.push(card);
    else groups.set(card.inputKey, [card]);
  }
  const idMap = new Map<string, string>();
  const shown: ScenarioCard[] = [];
  for (const card of cards) {
    const group = groups.get(card.inputKey) ?? [card];
    const survivor = group[0]!;
    idMap.set(card.id, survivor.id);
    if (card !== survivor) continue;
    for (const other of group.slice(1)) {
      survivor.nightly = survivor.nightly || other.nightly;
      if (other.origin === "advisor" || other.advisorCopy) survivor.advisorCopy = true;
      if (survivor.scenarioId == null) survivor.scenarioId = other.scenarioId;
    }
    shown.push(survivor);
  }
  const nextId = idMap.get(suggestionId) ?? suggestionId;
  for (const card of shown) {
    card.suggested = card.id === nextId;
    card.recommendable = card.comparable && (card.origin !== "today" || card.suggested);
    card.badges = sourceBadges(card);
  }
  const winner = shown.find((card) => card.id === nextId);
  return { cards: shown, suggestionId: nextId, suggestionName: winner?.name ?? "" };
}

function comparableNote(inputs: CaseInputs): string | null {
  if (inputs.current.months != null) return null;
  const nightly = pipelineResults.find((row) => row.household_id === inputs.planned.household.household_id);
  const plan = nightly ? nightlyOnCase(inputs, nightly.best_plan) : null;
  return neverComparableReason(plan?.months == null ? null : formatMonths(plan.months));
}

function latestDebtEdit(
  overrides: readonly CaseOverride[],
  debtId: string,
  field: string,
): CaseOverride | undefined {
  const matches = overrides.filter(
    (row) => row.entity_type === "debt" && row.entity_id === debtId && row.field === field,
  );
  return matches[matches.length - 1];
}

function flagOn(hits: readonly FlagHit[], flag: FlagHit["flag"], entityId: string): boolean {
  return hits.some((hit) => hit.flag === flag && hit.entityId === entityId);
}

/** The edit line and whether that edit cleared a source flag. */
function debtEdit(
  debtId: string,
  payment: number,
  rate: number,
  overrides: readonly CaseOverride[],
  sourceFlags: readonly FlagHit[],
  caseFlags: readonly FlagHit[],
): { edits: string[]; resolved: boolean } {
  const edits: string[] = [];
  let resolved = false;
  const paymentEdit = latestDebtEdit(overrides, debtId, "monthly_payment");
  if (paymentEdit) {
    edits.push(
      editedValueLine(formatMoney(payment), {
        original: formatMoney(Number(paymentEdit.source_value)),
        next: formatMoney(Number(paymentEdit.override_value)),
        reason: paymentEdit.reason,
        by: paymentEdit.changed_by,
        at: formatDate(String(paymentEdit.changed_at)),
      }),
    );
    const cleared =
      (flagOn(sourceFlags, "payment_below_interest", debtId) && !flagOn(caseFlags, "payment_below_interest", debtId)) ||
      (flagOn(sourceFlags, "zero_payment", debtId) && !flagOn(caseFlags, "zero_payment", debtId));
    if (cleared) resolved = true;
  }
  const rateEdit = latestDebtEdit(overrides, debtId, "rate");
  if (rateEdit) {
    edits.push(
      editedValueLine(formatRate(rate), {
        original: formatRate(Number(rateEdit.source_value)),
        next: formatRate(Number(rateEdit.override_value)),
        reason: rateEdit.reason,
        by: rateEdit.changed_by,
        at: formatDate(String(rateEdit.changed_at)),
      }),
    );
    if (flagOn(sourceFlags, "zero_rate", debtId) && !flagOn(caseFlags, "zero_rate", debtId)) resolved = true;
  }
  return { edits, resolved };
}

export function workspaceFor(
  householdId: string,
  caseId: string | null,
  caseState: CaseState,
  scenarios: readonly Scenario[],
  recommendedScenarioId?: string | null,
): WorkspaceModel | null {
  const overrides = caseId == null ? [] : caseState.overrides.filter((row) => row.case_id === caseId);
  const inputs = caseInputs(householdId, overrides);
  if (!inputs) return null;
  const scoped = { ...caseState, overrides };
  const prepared = normalizeSeededScenarios(scenarios, overrides);
  const rows = prepared.filter((scenario) => caseId != null && scenario.case_id === caseId);
  const model = assembleWorkspace(inputs, rows, scoped);
  const source = loadHousehold(householdId);
  const sourceFlags = flags(source.household, source.members, source.debts, source.properties);
  const caseFlags = flags(inputs.planned.household, inputs.planned.members, inputs.planned.debts, inputs.planned.properties);
  const recommended =
    recommendedScenarioId !== undefined
      ? recommendedScenarioId
      : (cases.find((row) => row.case_id === caseId)?.recommended_scenario_id ?? null);
  for (const card of model.cards) {
    card.previouslyRecommended = recommended != null && card.scenarioId === recommended;
    card.badges = sourceBadges(card);
  }
  model.debtRows = withoutExcludedDuplicates(
    inputs.household.debts.map((debt) => {
      const story = debtEdit(debt.debt_id, debt.monthly_payment, debt.rate, overrides, sourceFlags, caseFlags);
      return {
        debtId: debt.debt_id,
        name: debt.debt_name,
        rate: formatRate(debt.rate),
        included: debt.monthly_payment > 0 && !inputs.excluded.has(debt.debt_id),
        edits: story.edits,
        resolved: story.resolved,
        duplicateExcluded: false,
      };
    }),
    sourceFlags,
    inputs.excluded,
  );
  return model;
}

/** Drop the excluded copy of a duplicate and mark the one that remains. */
function withoutExcludedDuplicates(
  rows: DebtRow[],
  sourceFlags: readonly FlagHit[],
  excluded: ReadonlySet<string>,
): DebtRow[] {
  const drop = new Set<string>();
  const marked = new Set<string>();
  for (const hit of sourceFlags) {
    if (hit.flag !== "possible_duplicate") continue;
    const ids = hit.entityId.split(";").filter((id) => id !== "");
    const gone = ids.filter((id) => excluded.has(id));
    const kept = ids.filter((id) => !excluded.has(id));
    if (gone.length === 0 || kept.length === 0) continue;
    for (const id of gone) drop.add(id);
    for (const id of kept) marked.add(id);
  }
  return rows
    .filter((row) => !drop.has(row.debtId))
    .map((row) => (marked.has(row.debtId) ? { ...row, duplicateExcluded: true } : row));
}

export function previewHousehold(
  householdId: string,
  caseId: string,
  caseState: CaseState,
  draft: ScenarioDraft,
): DraftPreview | null {
  const overrides = caseState.overrides.filter((row) => row.case_id === caseId);
  try {
    const state = householdWithCase(householdId, { ...caseState, overrides });
    return previewDraft(state, caseId, { ...caseState, overrides }, draft);
  } catch {
    return null;
  }
}

export function rateText(rate: number): string {
  const text = rate.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${text}%`;
}
