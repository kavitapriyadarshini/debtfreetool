import { householdFico } from "./engine/household";
import { casePreview, runScenario, type CaseState } from "./engine/scenario";
import type { ScheduleRow } from "./engine/simulate";
import { formatMoney } from "./format";
import type { Scenario } from "./types";
import { planDate } from "./compare";

const PAID = 0.005;

export type PresentDraft = {
  name: string;
  strategy: Scenario["strategy"];
  loanSource: Scenario["loan_source"];
  product: string | null;
  termMonths: number | null;
  loanAmount: number;
  loanRate: number | null;
  debtsPaidOff: string | null;
};

export type PresentChoice = {
  id: string;
  label: string;
  savedId: string | null;
  draft: PresentDraft;
};

export type PresentSide = {
  debtFree: string;
  interest: string;
  monthly: string;
  finishes: boolean;
  interestAmount: number;
  months: number | null;
  payoff: { name: string; when: string }[];
};

export type PresentModel = {
  name: string;
  estimated: boolean;
  leftOut: string[];
  today: PresentSide;
  plan: PresentSide;
  interestSaved: string;
  monthsSooner: string;
  loan: string | null;
  choices: PresentChoice[];
  selectedId: string;
};

function splitIds(value: string | null | undefined): string[] {
  return (value ?? "").split(";").filter((id) => id !== "");
}

function friendlyName(name: string): string {
  const [last, rest] = name.split(", ");
  if (!last || !rest) return name;
  return `${rest} ${last}`;
}

function bare(
  caseId: string,
  householdId: string,
  name: string,
  strategy: Scenario["strategy"],
): Scenario {
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

function toDraft(scenario: Scenario): PresentDraft {
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

function debtLabel(id: string, names: Map<string, string>): string {
  if (id === "NEW_LOAN") return "New loan";
  return names.get(id) ?? id;
}

function payoffOf(rows: readonly ScheduleRow[], names: Map<string, string>, moved: readonly string[]): { name: string; when: string }[] {
  const seen = new Map<string, string>();
  const label = (id: string) => {
    const existing = seen.get(id);
    if (existing) return existing;
    const base = debtLabel(id, names);
    const name = new Set(seen.values()).has(base) ? `${base} (${id})` : base;
    seen.set(id, name);
    return name;
  };
  const steps = moved.map((id) => ({ name: label(id), when: "When the plan starts", month: 0 }));
  const live = new Set<string>();
  for (const row of rows) {
    for (const debt of row.debts) live.add(debt.id);
  }
  const later = [...live].flatMap((id) => {
    const row = rows.find((item) => item.debts.some((debt) => debt.id === id && debt.closingBalance <= PAID));
    if (!row) return [];
    return [{ name: label(id), when: planDate(row.month), month: row.month }];
  });
  later.sort((a, b) => a.month - b.month);
  return [...steps, ...later].map(({ name, when }) => ({ name, when }));
}

function loanSentence(scenario: Scenario): string | null {
  if (scenario.loan_source === "none" || scenario.loan_amount <= 0) return null;
  if (scenario.product?.startsWith("HELOAN")) return "This plan includes a loan. It is secured on your home.";
  if (scenario.loan_source === "product") return "This plan includes a loan. It is not secured on your home.";
  return "This plan includes a loan.";
}

function sideFrom(result: { months: number | null; totalInterest: number; requiredMonthly: number; schedule: ScheduleRow[] }, names: Map<string, string>, moved: string[]): PresentSide {
  return {
    debtFree: result.months == null ? "These payments don't clear the debts." : planDate(result.months),
    interest: result.months == null ? "—" : formatMoney(result.totalInterest),
    monthly: formatMoney(result.requiredMonthly),
    finishes: result.months != null,
    interestAmount: result.totalInterest,
    months: result.months,
    payoff: payoffOf(result.schedule, names, moved),
  };
}

function monthsSooner(today: number | null, plan: number | null): string {
  if (today == null && plan != null) return "Sooner than today's payments";
  if (today != null && plan == null) return "Longer than today's payments";
  if (today == null || plan == null) return "Same time";
  const delta = today - plan;
  if (delta === 0) return "Same time";
  const count = Math.abs(delta);
  const unit = count === 1 ? "month" : "months";
  return delta > 0 ? `${count} ${unit} sooner` : `${count} ${unit} longer`;
}

function interestSaved(today: PresentSide, plan: PresentSide): string {
  if (!today.finishes || !plan.finishes) return "—";
  const saved = Math.round(today.interestAmount) - Math.round(plan.interestAmount);
  if (saved > 0) return `${formatMoney(saved)} less`;
  if (saved < 0) return `${formatMoney(-saved)} more`;
  return "The same";
}

export function presentFor(
  householdId: string,
  caseId: string | null,
  caseState: CaseState,
  scenarios: readonly Scenario[],
  selectedId: string,
): PresentModel | null {
  const overrides = caseId == null ? [] : caseState.overrides.filter((row) => row.case_id === caseId);
  let preview;
  try {
    preview = casePreview(householdId, overrides);
  } catch {
    return null;
  }
  const bound = caseId ?? "draft";
  const saved = scenarios.filter((row) => caseId != null && row.case_id === caseId);
  const choices: { id: string; label: string; scenario: Scenario; savedId: string | null }[] = saved.map((row) => ({
    id: row.scenario_id,
    label: row.name,
    scenario: { ...row, case_id: bound },
    savedId: row.scenario_id,
  }));
  for (const strategy of ["avalanche", "snowball"] as const) {
    const label = strategy === "avalanche" ? "Avalanche" : "Snowball";
    choices.push({
      id: strategy,
      label,
      scenario: bare(bound, householdId, label, strategy),
      savedId: null,
    });
  }
  const recommended = saved.find((row) => row.is_recommended)?.scenario_id ?? null;
  const selected =
    choices.find((choice) => choice.id === selectedId) ??
    choices.find((choice) => choice.id === recommended) ??
    choices[0];
  if (!selected) return null;

  const scoped = { ...caseState, overrides };
  const names = new Map(preview.state.debts.map((debt) => [debt.debt_id, debt.debt_name]));
  const todayScenario = bare(bound, householdId, "Today", "current");
  const todayResult = runScenario(householdId, scoped, todayScenario);
  const planResult = runScenario(householdId, scoped, selected.scenario);
  const today = sideFrom(todayResult, names, []);
  const plan = sideFrom(planResult, names, splitIds(selected.scenario.debts_paid_off));
  const leftOut = preview.state.debts
    .filter((debt) => preview.excluded.has(debt.debt_id) || debt.monthly_payment <= 0)
    .map((debt) => debt.debt_name);

  return {
    name: friendlyName(preview.state.household.household_name),
    estimated: householdFico(preview.state.members).defaulted,
    leftOut,
    today,
    plan,
    interestSaved: interestSaved(today, plan),
    monthsSooner: monthsSooner(today.months, plan.months),
    loan: loanSentence(selected.scenario),
    choices: choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      savedId: choice.savedId,
      draft: toDraft(choice.scenario),
    })),
    selectedId: selected.id,
  };
}
