import { PLAN_START } from "./config";
import { bestOffer, builtInPlans, planFromOffer, suggestion } from "./engine/bestPlan";
import { householdFico } from "./engine/household";
import { buildOffers } from "./engine/offers";
import { householdWithCase, runScenario, type CaseState } from "./engine/scenario";
import type { ScheduleRow } from "./engine/simulate";
import { formatMoney } from "./format";
import type { PaymentAlert, Scenario } from "./types";
import {
  NEVER_NOTE,
  alertLabel,
  workspaceFor,
  type OfferChoice,
  type ScenarioCard,
} from "./workspace";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COMPARE_LIMIT = 4;
const PAID = 0.005;

export type RecommendDraft = {
  name: string;
  strategy: Scenario["strategy"];
  loanSource: Scenario["loan_source"];
  product: string | null;
  termMonths: number | null;
  loanAmount: number;
  loanRate: number | null;
  debtsPaidOff: string | null;
};

export type PayoffStep = { name: string; when: string };

export type CompareSeries = { key: string; name: string };

export type ComparePoint = { label: string; balances: number[] };

export type CompareColumn = {
  id: string;
  name: string;
  debtFreeDate: string;
  monthsSaved: string;
  interest: string;
  monthly: string;
  alert: PaymentAlert;
  alertLabel: string;
  note: string | null;
  loan: boolean;
  matchesSuggestion: boolean;
  savedScenarioId: string | null;
  draft: RecommendDraft;
  series: CompareSeries[];
  points: ComparePoint[];
  payoff: PayoffStep[];
};

export type CompareView = {
  columns: CompareColumn[];
  suggestionId: string;
  suggestionName: string;
  suggestionSavedId: string | null;
  why: string;
  addedBaselines: boolean;
  dropped: boolean;
};

/** Calendar month a plan month falls in. Plan month 1 is December 2026. */
export function planDate(planMonth: number): string {
  const [year, month] = PLAN_START.split("-").map(Number);
  const index = year! * 12 + (month! - 1) + Math.max(planMonth, 1) - 1;
  return `${MONTHS[index % 12]} ${Math.floor(index / 12)}`;
}

function splitIds(value: string | null | undefined): string[] {
  return (value ?? "").split(";").filter((id) => id !== "");
}

function monthCount(months: number | null): string {
  if (months == null) return "Never";
  return `${months} ${months === 1 ? "month" : "months"}`;
}

function monthsSaved(current: number | null, months: number | null, baseline: boolean): string {
  if (baseline) return "—";
  if (current == null && months != null) return "From never";
  if (current == null || months == null) return "—";
  const saved = current - months;
  if (saved <= 0) return "0 months";
  return `${saved} ${saved === 1 ? "month" : "months"}`;
}

function isLoanCard(card: ScenarioCard, scenarios: readonly Scenario[]): boolean {
  if (card.id === "current" || card.id === "avalanche" || card.id === "snowball") return false;
  if (card.id.startsWith("offer:")) return true;
  const saved = scenarios.find((row) => row.scenario_id === card.id);
  return saved != null && saved.loan_source !== "none";
}

function sameOffer(
  scenario: Scenario,
  offer: { product: string; term_months: number; loan_amount: number; debts_paid_off: string },
): boolean {
  if (scenario.extra_payment_ids) return false;
  if (scenario.loan_source !== "product" || scenario.strategy !== "avalanche") return false;
  return (
    scenario.product === offer.product &&
    scenario.term_months === offer.term_months &&
    scenario.loan_amount === offer.loan_amount &&
    splitIds(scenario.debts_paid_off).join(";") === offer.debts_paid_off
  );
}

function sameBuiltin(scenario: Scenario, strategy: Scenario["strategy"]): boolean {
  return (
    !scenario.extra_payment_ids &&
    scenario.loan_source === "none" &&
    scenario.strategy === strategy &&
    !scenario.loan_amount
  );
}

function blankScenario(caseId: string, householdId: string, name: string, strategy: Scenario["strategy"]): Scenario {
  return {
    scenario_id: "draft",
    case_id: caseId,
    household_id: householdId,
    name,
    strategy,
    loan_source: "none",
    product: null,
    term_months: null,
    loan_amount: 0,
    loan_rate: null,
    debts_paid_off: null,
    extra_payment_ids: null,
    created_by: "",
    is_recommended: false,
    advisor_reason: null,
  };
}

function offerScenario(caseId: string, householdId: string, choice: OfferChoice): Scenario {
  return {
    scenario_id: "draft",
    case_id: caseId,
    household_id: householdId,
    name: choice.label,
    strategy: "avalanche",
    loan_source: "product",
    product: choice.product,
    term_months: choice.termMonths,
    loan_amount: choice.amount,
    loan_rate: choice.rate,
    debts_paid_off: choice.debtIds.join(";") || null,
    extra_payment_ids: null,
    created_by: "",
    is_recommended: false,
    advisor_reason: null,
  };
}

function toDraft(scenario: Scenario): RecommendDraft {
  return {
    name: scenario.name,
    strategy: scenario.strategy,
    loanSource: scenario.loan_source,
    product: scenario.product,
    termMonths: scenario.term_months,
    loanAmount: scenario.loan_amount,
    loanRate: scenario.loan_rate,
    debtsPaidOff: scenario.debts_paid_off,
  };
}

function debtName(id: string, names: Map<string, string>): string {
  if (id === "NEW_LOAN") return "New loan";
  return names.get(id) ?? id;
}

function scheduleOf(
  rows: readonly ScheduleRow[],
  names: Map<string, string>,
  moved: readonly string[],
): { series: CompareSeries[]; points: ComparePoint[]; payoff: PayoffStep[] } {
  const seen = new Map<string, string>();
  const order: string[] = [];
  const remember = (id: string) => {
    if (seen.has(id)) return;
    const base = debtName(id, names);
    const taken = new Set(seen.values());
    const name = taken.has(base) ? `${base} (${id})` : base;
    seen.set(id, name);
    order.push(id);
  };
  for (const id of moved) remember(id);
  for (const row of rows) {
    for (const debt of row.debts) remember(debt.id);
  }
  const live = order.filter((id) => !moved.includes(id));
  const series = live.map((id) => ({ key: id, name: seen.get(id) ?? id }));
  const points = rows.map((row) => ({
    label: planDate(row.month),
    balances: live.map((id) => {
      const debt = row.debts.find((item) => item.id === id);
      return debt ? Math.max(0, Math.round(debt.closingBalance)) : 0;
    }),
  }));
  const payoff: PayoffStep[] = moved.map((id) => ({ name: seen.get(id) ?? id, when: "When the plan starts" }));
  const later = live.flatMap((id) => {
    const row = rows.find((item) => item.debts.some((debt) => debt.id === id && debt.closingBalance <= PAID));
    if (!row) return [];
    return [{ name: seen.get(id) ?? id, when: planDate(row.month), month: row.month }];
  });
  later.sort((a, b) => a.month - b.month);
  for (const step of later) payoff.push({ name: step.name, when: step.when });
  return { series, points, payoff };
}

function columnNote(months: number | null, estimated: boolean): string | null {
  const parts = [months == null ? NEVER_NOTE : null, estimated ? "estimated" : null].filter(
    (part): part is string => part != null,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function compareFor(
  householdId: string,
  caseId: string | null,
  caseState: CaseState,
  scenarios: readonly Scenario[],
  selectedIds: readonly string[],
): CompareView | null {
  const overrides = caseId == null ? [] : caseState.overrides.filter((row) => row.case_id === caseId);
  const scoped = { ...caseState, overrides };
  let state;
  try {
    state = householdWithCase(householdId, scoped);
  } catch {
    return null;
  }
  const model = workspaceFor(householdId, caseId, scoped, scenarios);
  if (!model) return null;

  const saved = scenarios.filter((row) => caseId != null && row.case_id === caseId);
  const scoreEstimated = householdFico(state.members).defaulted;
  const cards = new Map(model.cards.map((card) => [card.id, card]));
  const chosen = selectedIds.filter((id) => cards.has(id));
  const loanSelected = chosen.some((id) => isLoanCard(cards.get(id)!, saved));
  const ordered: string[] = [];
  if (loanSelected) {
    if (cards.has("avalanche")) ordered.push("avalanche");
    if (cards.has("snowball")) ordered.push("snowball");
  }
  for (const id of chosen) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  const ids = ordered.slice(0, COMPARE_LIMIT);
  const addedBaselines =
    loanSelected && (!chosen.includes("avalanche") || !chosen.includes("snowball"));

  const plans = builtInPlans(state, { schedule: false });
  const offers = buildOffers(state);
  const best = bestOffer(offers);
  const options = [plans.current, plans.avalanche, plans.snowball];
  if (best) options.push(planFromOffer(best));
  const suggested = suggestion(options);
  const suggestionId =
    suggested.plan.name === "Current path"
      ? "current"
      : suggested.plan.name === "Avalanche"
        ? "avalanche"
        : suggested.plan.name === "Snowball"
          ? "snowball"
          : best
            ? `offer:${best.product}:${best.term_months}:${best.property_id ?? "none"}`
            : "current";
  const suggestionCard = cards.get(suggestionId);
  const suggestionSaved =
    saved.find((row) =>
      best && suggestionId.startsWith("offer:")
        ? sameOffer(row, best)
        : suggestionId === "current"
          ? sameBuiltin(row, "current")
          : suggestionId === "avalanche"
            ? sameBuiltin(row, "avalanche")
            : suggestionId === "snowball"
              ? sameBuiltin(row, "snowball")
              : false,
    ) ?? null;

  const names = new Map(state.debts.map((debt) => [debt.debt_id, debt.debt_name]));
  const boundCase = caseId ?? "draft";
  const columns = ids.flatMap((id) => {
    const card = cards.get(id);
    if (!card) return [];
    const choice = model.choices.find((row) => row.id === id);
    const existing = saved.find((row) => row.scenario_id === id);
    const scenario = existing
      ? { ...existing, case_id: boundCase }
      : choice
        ? offerScenario(boundCase, householdId, choice)
        : blankScenario(
            boundCase,
            householdId,
            card.name,
            id === "snowball" ? "snowball" : id === "current" ? "current" : "avalanche",
          );
    const result = runScenario(householdId, scoped, scenario);
    const moved = splitIds(scenario.debts_paid_off);
    const schedule = scheduleOf(result.schedule, names, moved);
    const savedScenarioId =
      existing?.scenario_id ??
      saved.find((row) =>
        choice
          ? sameOffer(row, {
              product: choice.product,
              term_months: choice.termMonths,
              loan_amount: choice.amount,
              debts_paid_off: choice.debtIds.join(";"),
            })
          : id === "current" || id === "avalanche" || id === "snowball"
            ? sameBuiltin(row, id)
            : false,
      )?.scenario_id ??
      null;
    const matchesSuggestion =
      id === suggestionId || (savedScenarioId != null && savedScenarioId === suggestionSaved?.scenario_id);
    return [
      {
        id,
        name: card.name,
        debtFreeDate: result.months == null ? "Never" : planDate(result.months),
        monthsSaved: monthsSaved(plans.current.months, result.months, id === "current"),
        interest: formatMoney(result.totalInterest),
        monthly: formatMoney(result.requiredMonthly),
        alert: result.paymentAlert,
        alertLabel: alertLabel(result.paymentAlert, result.paymentChangePct),
        note: columnNote(result.months, scoreEstimated && (scenario.product?.startsWith("HELOAN") || card.name.startsWith("HELOAN"))),
        loan: isLoanCard(card, saved),
        matchesSuggestion,
        savedScenarioId,
        draft: toDraft(scenario),
        series: schedule.series,
        points: schedule.points,
        payoff: schedule.payoff,
      } satisfies CompareColumn,
    ];
  });

  return {
    columns,
    suggestionId,
    suggestionName: suggestionCard?.name ?? suggested.plan.name,
    suggestionSavedId: suggestionSaved?.scenario_id ?? null,
    why: suggested.why,
    addedBaselines,
    dropped: ordered.length > COMPARE_LIMIT,
  };
}
