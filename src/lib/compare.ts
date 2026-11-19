import { householdFico } from "./engine/household";
import { householdWithCase, runScenario, type CaseState } from "./engine/scenario";
import type { ScheduleRow } from "./engine/simulate";
import { formatRate, planDate } from "./format";
import type { PaymentAlert, Scenario } from "./types";
import {
  NEVER_NOTE,
  workspaceFor,
  type OfferChoice,
  type ScenarioCard,
} from "./workspace";

export { planDate };

/** Plans the advisor ticks, besides the current path. */
export const COMPARE_PICKS = 3;
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

export type PayoffStep = {
  name: string;
  when: string;
  /** Edited values on this debt, each with its most recent reason. */
  edits: string[];
  resolved: boolean;
};

export type CompareSeries = { key: string; name: string };

export type ComparePoint = { label: string; balances: number[] };

export type CompareColumn = {
  id: string;
  name: string;
  debtFreeDate: string;
  monthsSaved: string;
  interest: string;
  interestSaved: string;
  monthly: string;
  alert: PaymentAlert;
  alertLabel: string;
  note: string | null;
  loan: boolean;
  badges: string[];
  recommendable: boolean;
  matchesSuggestion: boolean;
  savedScenarioId: string | null;
  /** Months saved against the current path. Null when that comparison has no number. */
  monthsSavedCount: number | null;
  draft: RecommendDraft;
  series: CompareSeries[];
  points: ComparePoint[];
  payoff: PayoffStep[];
  /** Plain lines for each payment change, in date order. */
  moneyGoes: string[];
};

export type CompareView = {
  columns: CompareColumn[];
  suggestionId: string;
  suggestionName: string;
  suggestionSavedId: string | null;
  why: string;
  /** Set when today's path never finishes. */
  comparableNote: string | null;
  addedBaselines: boolean;
};

/** The ids to show after "Add to comparison". Replaces the plan that saves the fewest months once three are already compared. */
export function nextComparison(
  columns: readonly { id: string; name: string; monthsSavedCount: number | null }[],
  suggestionId: string,
): { ids: string[]; replaced: string | null } {
  const others = columns.filter((column) => column.id !== "current");
  if (others.some((column) => column.id === suggestionId)) {
    return { ids: others.map((column) => column.id), replaced: null };
  }
  if (others.length < COMPARE_PICKS) {
    return { ids: [...others.map((column) => column.id), suggestionId], replaced: null };
  }
  const worst = others.reduce((least, column) => (savedRank(column) < savedRank(least) ? column : least));
  return {
    ids: others.map((column) => (column.id === worst.id ? suggestionId : column.id)),
    replaced: worst.name,
  };
}

function savedRank(column: { monthsSavedCount: number | null }): number {
  return column.monthsSavedCount == null ? Number.NEGATIVE_INFINITY : column.monthsSavedCount;
}

function splitIds(value: string | null | undefined): string[] {
  return (value ?? "").split(";").filter((id) => id !== "");
}

function monthCount(months: number | null): string {
  if (months == null) return "Never";
  return `${months} ${months === 1 ? "month" : "months"}`;
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
  return names.get(id) ?? (id === "NEW_LOAN" ? "New loan" : id);
}

function scheduleOf(
  rows: readonly ScheduleRow[],
  names: Map<string, string>,
  moved: readonly string[],
  edits: ReadonlyMap<string, { edits: string[]; resolved: boolean }>,
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
  const detail = (id: string) => edits.get(id) ?? { edits: [], resolved: false };
  const payoff: PayoffStep[] = moved.map((id) => ({
    name: seen.get(id) ?? id,
    when: "When the plan starts",
    edits: detail(id).edits,
    resolved: detail(id).resolved,
  }));
  const later = live.flatMap((id) => {
    const row = rows.find((item) => item.debts.some((debt) => debt.id === id && debt.closingBalance <= PAID));
    if (!row) return [];
    return [{ id, name: seen.get(id) ?? id, when: planDate(row.month), month: row.month }];
  });
  later.sort((a, b) => a.month - b.month);
  for (const step of later) {
    payoff.push({
      name: step.name,
      when: step.when,
      edits: detail(step.id).edits,
      resolved: detail(step.id).resolved,
    });
  }
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
  const chosen = selectedIds.filter((id) => {
    const card = cards.get(id);
    return card != null && card.comparable;
  });
  const loanSelected = chosen.some((id) => isLoanCard(cards.get(id)!, saved));
  const picks = chosen.filter((id) => id !== "current").slice(0, COMPARE_PICKS);
  const baselines: string[] = [];
  if (loanSelected) {
    for (const id of ["avalanche", "snowball"]) {
      if (baselines.length >= COMPARE_PICKS - picks.length) break;
      if (!picks.includes(id) && cards.has(id)) baselines.push(id);
    }
  }
  const ids = [...(cards.has("current") ? ["current"] : []), ...baselines, ...picks];
  const addedBaselines = baselines.length > 0;

  const suggestionId = model.suggestionId;
  const suggestionCard = cards.get(suggestionId);
  const suggestionChoice = model.choices.find((row) => row.id === suggestionId);
  const suggestionSaved =
    (suggestionCard?.scenarioId
      ? saved.find((row) => row.scenario_id === suggestionCard.scenarioId)
      : undefined) ??
    saved.find((row) =>
      suggestionChoice
        ? sameOffer(row, {
            product: suggestionChoice.product,
            term_months: suggestionChoice.termMonths,
            loan_amount: suggestionChoice.amount,
            debts_paid_off: suggestionChoice.debtIds.join(";"),
          })
        : suggestionId === "current" || suggestionId === "avalanche" || suggestionId === "snowball"
          ? sameBuiltin(row, suggestionId)
          : false,
    ) ??
    null;

  const currentSpan = cards.get("current")?.spanMonths ?? null;
  const names = new Map(state.debts.map((debt) => [debt.debt_id, `${debt.debt_name} · ${formatRate(debt.rate)}`]));
  const edits = new Map(
    model.debtRows.map((row) => [
      row.debtId,
      { edits: row.edits, resolved: row.resolved },
    ]),
  );
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
    const columnNames = new Map(names);
    if (card.loanDebt) columnNames.set("NEW_LOAN", card.loanDebt);
    const schedule = scheduleOf(result.schedule, columnNames, moved, edits);
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
    return [
      {
        id,
        name: card.name,
        debtFreeDate: result.months == null ? NEVER_NOTE : planDate(result.months),
        monthsSaved: card.monthsSaved,
        interest: card.interest,
        interestSaved: card.interestSaved,
        monthly: card.monthly,
        alert: card.alert,
        alertLabel: card.alertLabel,
        note: columnNote(result.months, scoreEstimated && (scenario.product?.startsWith("HELOAN") || card.name.startsWith("HELOAN"))),
        loan: isLoanCard(card, saved),
        badges: card.badges,
        recommendable: card.recommendable,
        matchesSuggestion: card.suggested,
        savedScenarioId,
        monthsSavedCount:
          card.spanMonths == null || currentSpan == null ? null : currentSpan - card.spanMonths,
        draft: toDraft(scenario),
        series: schedule.series,
        points: schedule.points,
        payoff: schedule.payoff,
        moneyGoes: card.moneyGoes,
      } satisfies CompareColumn,
    ];
  });

  return {
    columns,
    suggestionId,
    suggestionName: model.suggestionName,
    suggestionSavedId: suggestionSaved?.scenario_id ?? null,
    why: model.suggestionWhy,
    comparableNote: model.comparableNote,
    addedBaselines,
  };
}
