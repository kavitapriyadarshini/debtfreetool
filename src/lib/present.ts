import { AS_OF } from "./config";
import { householdFico } from "./engine/household";
import { casePreview, runScenario, type CaseState, type ScenarioRun } from "./engine/scenario";
import type { BuiltOffer } from "./engine/offers";
import type { ScheduleRow } from "./engine/simulate";
import { planKey } from "./case-inputs";
import { formatDate, formatMoney, formatMonths, formatRate } from "./format";
import { workspaceFor, type ScenarioCard } from "./workspace";
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

export type PresentMonth = {
  label: string;
  debts: { name: string; payment: string; interest: string; balance: string }[];
};

export type PresentYear = {
  year: number;
  startBalance: string;
  endBalance: string;
  cleared: string[];
  months: PresentMonth[];
};

export type PresentSide = {
  debtFree: string;
  interest: string;
  monthly: string;
  finishes: boolean;
  interestAmount: number;
  months: number | null;
  payoff: { name: string; when: string }[];
  years: PresentYear[];
};

/** One column on the household comparison. Grey columns are the other compared plans. */
export type PresentColumn = {
  id: string;
  heading: string;
  tone: "today" | "plan" | "other";
  debtFree: string;
  sooner: string;
  interest: string;
  interestSaved: string;
  monthly: string;
  payoff: { name: string; when: string }[];
  /** Origin of a grey column, shown in small text. Empty for Today and Your plan. */
  source: string;
};

export type PresentModel = {
  name: string;
  title: string;
  advisor: string;
  date: string;
  estimated: boolean;
  leftOut: string[];
  today: PresentSide;
  plan: PresentSide;
  interestSaved: string;
  monthsSooner: string;
  /** Kept for the saved snapshot. The household screen uses thingsToKnow instead. */
  loan: string | null;
  advantages: string[];
  thingsToKnow: string[];
  columns: PresentColumn[];
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

function loanName(scenario: Scenario): string {
  if (scenario.product?.startsWith("HELOAN")) return "Home equity loan";
  return "New loan";
}

/** Household-facing name. Built from the loan and the order, never from the stored title. */
export function plainPlanName(scenario: Scenario): string {
  const loan = scenario.loan_source !== "none" && scenario.loan_amount > 0;
  const home = scenario.product?.startsWith("HELOAN") ?? false;
  const smallest = scenario.strategy === "snowball";
  if (home) {
    return smallest
      ? "Pay off your cards with a home equity loan, then clear the smallest balance first"
      : "Pay off your cards with a home equity loan, then clear the rest in order";
  }
  if (loan) {
    return smallest
      ? "Pay off some debts with a new loan, then clear the smallest balance first"
      : "Pay off some debts with a new loan, then clear the rest in order";
  }
  if (smallest) return "Keep today's payment and clear the smallest balance first";
  if (scenario.strategy === "avalanche") return "Keep today's payment and clear the highest rate first";
  return "Keep paying each debt as you do today";
}

function debtLabel(id: string, names: Map<string, string>, loan: string): string {
  if (id === "NEW_LOAN") return loan;
  return names.get(id) ?? "Debt";
}

function nameOf(id: string, names: Map<string, string>, loan: string, seen: Map<string, string>): string {
  const existing = seen.get(id);
  if (existing) return existing;
  const base = debtLabel(id, names, loan);
  const taken = new Set(seen.values());
  let name = base;
  let count = 2;
  while (taken.has(name)) {
    name = `${base} (${count})`;
    count += 1;
  }
  seen.set(id, name);
  return name;
}

function ratedDebt(id: string, base: string, rates: ReadonlyMap<string, number>, loanRate: number | null): string {
  if (id === "NEW_LOAN") return loanRate == null ? base : `${base} · ${formatRate(loanRate)}`;
  const rate = rates.get(id);
  return rate == null ? base : `${base} · ${formatRate(rate)}`;
}

function payoffOf(
  rows: readonly ScheduleRow[],
  names: Map<string, string>,
  rates: ReadonlyMap<string, number>,
  moved: readonly string[],
  loan: string,
  loanRate: number | null,
): { name: string; when: string }[] {
  const seen = new Map<string, string>();
  const steps = moved.map((id) => ({
    name: ratedDebt(id, nameOf(id, names, loan, seen), rates, loanRate),
    when: "When the plan starts",
    month: 0,
  }));
  const live = new Set<string>();
  for (const row of rows) {
    for (const debt of row.debts) live.add(debt.id);
  }
  const later = [...live].flatMap((id) => {
    const row = rows.find((item) => item.debts.some((debt) => debt.id === id && debt.closingBalance <= PAID));
    if (!row) return [];
    return [{
      name: ratedDebt(id, nameOf(id, names, loan, seen), rates, loanRate),
      when: planDate(row.month),
      month: row.month,
    }];
  });
  later.sort((a, b) => a.month - b.month);
  return [...steps, ...later].map(({ name, when }) => ({ name, when }));
}

function yearsOf(rows: readonly ScheduleRow[], names: Map<string, string>, moved: readonly string[], loan: string): PresentYear[] {
  const groups = new Map<number, ScheduleRow[]>();
  for (const row of rows) {
    const year = Number(planDate(row.month).slice(-4));
    const list = groups.get(year) ?? [];
    list.push(row);
    groups.set(year, list);
  }
  const seen = new Map<string, string>();
  const movedNames = moved.map((id) => nameOf(id, names, loan, seen));
  let firstYear = true;
  const years: PresentYear[] = [];
  for (const year of [...groups.keys()].sort((a, b) => a - b)) {
    const months = groups.get(year) ?? [];
    const first = months[0];
    const last = months[months.length - 1];
    if (!first || !last) continue;
    const cleared: string[] = [];
    const clearedNames = new Set<string>();
    if (firstYear) {
      for (const name of movedNames) {
        if (clearedNames.has(name)) continue;
        clearedNames.add(name);
        cleared.push(name);
      }
      firstYear = false;
    }
    for (const month of months) {
      for (const debt of month.debts) {
        if (debt.openingBalance <= PAID || debt.closingBalance > PAID) continue;
        const name = nameOf(debt.id, names, loan, seen);
        if (clearedNames.has(name)) continue;
        clearedNames.add(name);
        cleared.push(name);
      }
    }
    years.push({
      year,
      startBalance: formatMoney(first.debts.reduce((sum, debt) => sum + debt.openingBalance, 0)),
      endBalance: formatMoney(last.debts.reduce((sum, debt) => sum + debt.closingBalance, 0)),
      cleared,
      months: months.map((month) => ({
        label: planDate(month.month),
        debts: month.debts.map((debt) => ({
          name: nameOf(debt.id, names, loan, seen),
          payment: formatMoney(debt.payment),
          interest: formatMoney(debt.interest),
          balance: formatMoney(debt.closingBalance),
        })),
      })),
    });
  }
  return years;
}

function loanSentence(scenario: Scenario): string | null {
  if (scenario.loan_source === "none" || scenario.loan_amount <= 0) return null;
  if (scenario.product?.startsWith("HELOAN")) return "This plan includes a loan. It is secured on your home.";
  if (scenario.loan_source === "product") return "This plan includes a loan. It is not secured on your home.";
  return "This plan includes a loan.";
}

function sideFrom(
  result: ScenarioRun,
  names: Map<string, string>,
  rates: ReadonlyMap<string, number>,
  moved: string[],
  loan: string,
  loanRate: number | null,
): PresentSide {
  return {
    debtFree: result.months == null ? "These payments don't clear the debts." : planDate(result.months),
    interest: result.months == null ? "Not comparable" : formatMoney(result.totalInterest),
    monthly: formatMoney(result.requiredMonthly),
    finishes: result.months != null,
    interestAmount: result.totalInterest,
    months: result.months,
    payoff: payoffOf(result.schedule, names, rates, moved, loan, loanRate),
    years: yearsOf(result.schedule, names, moved, loan),
  };
}

function scenarioKey(scenario: Scenario): string {
  return planKey({
    strategy: scenario.strategy,
    loanSource: scenario.loan_source,
    product: scenario.product,
    termMonths: scenario.term_months,
    amount: scenario.loan_amount,
    rate: scenario.loan_rate,
    debtIds: splitIds(scenario.debts_paid_off),
    extraIds: splitIds(scenario.extra_payment_ids),
  });
}

const SOURCE_LABELS = ["Nightly best", "Built-in", "Built by you", "Previously recommended"];

function columnSource(
  choice: { id: string; savedId: string | null; scenario: Scenario },
  card: ScenarioCard | undefined,
  recommended: string | null,
): string {
  const parts = SOURCE_LABELS.filter((label) => card?.badges.includes(label));
  if (parts.length === 0) {
    if (choice.id === "avalanche" || choice.id === "snowball" || choice.id.startsWith("offer:")) parts.push("Built-in");
    else if (choice.savedId) parts.push("Built by you");
  }
  const recommendedHere = choice.id === recommended || choice.scenario.scenario_id === recommended;
  if (recommendedHere && !parts.includes("Previously recommended")) parts.push("Previously recommended");
  return parts.join(" · ");
}

function matchOffer(id: string, offers: readonly BuiltOffer[]): BuiltOffer | undefined {
  const match = /^offer:(.+):(\d+):(.+)$/.exec(id);
  if (!match) return undefined;
  const property = match[3] === "none" ? null : match[3];
  return offers.find(
    (offer) => offer.product === match[1] && offer.term_months === Number(match[2]) && (offer.property_id ?? null) === property,
  );
}

function fromOffer(id: string, offer: BuiltOffer, caseId: string, householdId: string): Scenario {
  return {
    scenario_id: id,
    case_id: caseId,
    household_id: householdId,
    name: offer.product,
    strategy: "avalanche",
    loan_source: "product",
    product: offer.product,
    term_months: offer.term_months,
    loan_amount: offer.loan_amount,
    loan_rate: offer.rate,
    debts_paid_off: offer.debts_paid_off || null,
    extra_payment_ids: null,
    created_by: "",
    is_recommended: false,
    advisor_reason: null,
  };
}

/** Rule 9 only. A line is included when the plan's numbers make it true. */
function ruleNine(
  scenario: Scenario,
  today: PresentSide,
  plan: PresentSide,
  planPay: number,
  todayPay: number,
  alert: ScenarioRun["paymentAlert"],
  included: number,
  moved: number,
  estimated: boolean,
  leftOut: readonly string[],
): { advantages: string[]; thingsToKnow: string[] } {
  const advantages: string[] = [];
  if (today.months != null && plan.months != null && today.months > plan.months) {
    advantages.push(`Debt free ${formatMonths(today.months - plan.months)} sooner.`);
  }
  if (today.finishes && plan.finishes) {
    const saved = Math.round(today.interestAmount) - Math.round(plan.interestAmount);
    if (saved > 0) advantages.push(`${formatMoney(saved)} less interest.`);
  }
  if (planPay < todayPay) advantages.push(`Monthly payment ${formatMoney(todayPay - planPay)} lower.`);
  const addsLoan = scenario.loan_source !== "none" && scenario.loan_amount > 0;
  const after = included - moved + (addsLoan ? 1 : 0);
  if (included > 0 && after > 0 && after !== included) advantages.push(`${included} debts become ${after}.`);

  const thingsToKnow: string[] = [];
  if (scenario.strategy !== "current") {
    thingsToKnow.push("The plan only works if you keep paying today's total each month as debts clear.");
  }
  if (planPay > todayPay && (alert === "amber" || alert === "red")) {
    thingsToKnow.push(`Monthly payment ${formatMoney(planPay - todayPay)} higher.`);
  }
  if (scenario.product?.startsWith("HELOAN")) {
    thingsToKnow.push("The new loan is secured on your home, which is at risk if payments are missed.");
  }
  if (addsLoan) thingsToKnow.push("A new loan needs a credit application.");
  const term = scenario.term_months;
  if (addsLoan && term != null && term > 0 && term % 12 === 0) {
    const years = term / 12;
    thingsToKnow.push(`The loan runs ${years} ${years === 1 ? "year" : "years"}.`);
  }
  if (estimated) thingsToKnow.push("Figures are estimated.");
  for (const name of leftOut) thingsToKnow.push(`${name} is not included in this plan.`);
  return { advantages, thingsToKnow };
}

function monthsSooner(today: number | null, plan: number | null): string {
  if (today == null && plan != null) return "Sooner than today's payments";
  if (today != null && plan == null) return "Longer than today's payments";
  if (today == null || plan == null) return "Same time";
  const delta = today - plan;
  if (delta === 0) return "Same time";
  const count = Math.abs(delta);
  const unit = count === 1 ? "month" : "months";
  return delta > 0 ? `${count} ${unit} sooner` : `${count} ${unit} later`;
}

function interestSaved(today: PresentSide, plan: PresentSide): string {
  if (!today.finishes || !plan.finishes) return "Not comparable";
  const saved = Math.round(today.interestAmount) - Math.round(plan.interestAmount);
  if (saved > 0) return `${formatMoney(saved)} less`;
  if (saved < 0) return `Costs ${formatMoney(-saved)} more`;
  return "The same";
}

export function presentFor(
  householdId: string,
  caseId: string | null,
  caseState: CaseState,
  scenarios: readonly Scenario[],
  selectedId: string,
  comparedIds: readonly string[] = [],
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
  const scoped = { ...caseState, overrides };
  const names = new Map(preview.state.debts.map((debt) => [debt.debt_id, debt.debt_name]));
  const rates = new Map(preview.state.debts.map((debt) => [debt.debt_id, debt.rate]));
  const todayScenario = bare(bound, householdId, "Today", "current");
  const todayResult = runScenario(householdId, scoped, todayScenario);
  const cards = workspaceFor(householdId, caseId, caseState, scenarios)?.cards ?? [];
  const cardFor = (choice: { id: string; scenario: Scenario }): ScenarioCard | undefined =>
    cards.find((card) => card.id === choice.id) ??
    cards.find((card) => choice.scenario.scenario_id !== "draft" && card.scenarioId === choice.scenario.scenario_id) ??
    cards.find((card) => card.inputKey === scenarioKey(choice.scenario));

  const addOffer = (id: string) => {
    if (!id || id === "current" || choices.some((choice) => choice.id === id)) return;
    const offer = matchOffer(id, todayResult.offers);
    if (!offer) return;
    const scenario = fromOffer(id, offer, bound, householdId);
    choices.push({ id, label: plainPlanName(scenario), scenario, savedId: null });
  };
  for (const id of comparedIds) addOffer(id);
  addOffer(selectedId);

  const selected =
    choices.find((choice) => choice.id === selectedId) ??
    choices.find((choice) => choice.id === recommended) ??
    choices[0];
  if (!selected) return null;

  const planResult = runScenario(householdId, scoped, selected.scenario);
  const loan = loanName(selected.scenario);
  const today = sideFrom(todayResult, names, rates, [], loan, null);
  const moved = splitIds(selected.scenario.debts_paid_off);
  const plan = sideFrom(planResult, names, rates, moved, loan, selected.scenario.loan_rate);
  const leftOut = preview.state.debts
    .filter((debt) => preview.excluded.has(debt.debt_id) || debt.monthly_payment <= 0)
    .map((debt) => debt.debt_name);
  const estimated = householdFico(preview.state.members).defaulted;
  const included = preview.state.debts.filter((debt) => !preview.excluded.has(debt.debt_id) && debt.monthly_payment > 0).length;
  const movedCount = moved.filter((id) => preview.state.debts.some((debt) => debt.debt_id === id && !preview.excluded.has(id) && debt.monthly_payment > 0)).length;
  const notes = ruleNine(
    selected.scenario,
    today,
    plan,
    Math.round(planResult.requiredMonthly),
    Math.round(todayResult.requiredMonthly),
    planResult.paymentAlert,
    included,
    movedCount,
    estimated,
    leftOut,
  );

  const otherIds = [...new Set([...comparedIds, recommended ?? ""])].filter(
    (id) => id !== "" && id !== "current" && id !== selected.id && choices.some((choice) => choice.id === id),
  );
  const columns: PresentColumn[] = [
    {
      id: "today",
      heading: "Today",
      tone: "today",
      debtFree: today.debtFree,
      sooner: "This is today",
      interest: today.interest,
      interestSaved: "This is today",
      monthly: today.monthly,
      payoff: today.payoff,
      source: "",
    },
    {
      id: selected.id,
      heading: "Your plan",
      tone: "plan",
      debtFree: plan.debtFree,
      sooner: monthsSooner(today.months, plan.months),
      interest: plan.interest,
      interestSaved: interestSaved(today, plan),
      monthly: plan.monthly,
      payoff: plan.payoff,
      source: "",
    },
  ];
  const seenPlans = new Set<string>([scenarioKey(selected.scenario)]);
  for (const id of otherIds) {
    const choice = choices.find((row) => row.id === id);
    if (!choice) continue;
    const key = scenarioKey(choice.scenario);
    if (seenPlans.has(key)) continue;
    seenPlans.add(key);
    const result = runScenario(householdId, scoped, choice.scenario);
    const side = sideFrom(
      result,
      names,
      rates,
      splitIds(choice.scenario.debts_paid_off),
      loanName(choice.scenario),
      choice.scenario.loan_rate,
    );
    columns.push({
      id,
      heading: plainPlanName(choice.scenario),
      tone: "other",
      debtFree: side.debtFree,
      sooner: monthsSooner(today.months, side.months),
      interest: side.interest,
      interestSaved: interestSaved(today, side),
      monthly: side.monthly,
      payoff: side.payoff,
      source: columnSource(choice, cardFor(choice), recommended),
    });
  }
  const titleCount = new Map<string, number>();
  for (const column of columns) {
    if (column.tone !== "other") continue;
    const title = `${column.heading}\n${column.source}`;
    titleCount.set(title, (titleCount.get(title) ?? 0) + 1);
  }
  for (const column of columns) {
    if (column.tone !== "other") continue;
    const title = `${column.heading}\n${column.source}`;
    if ((titleCount.get(title) ?? 0) < 2) continue;
    column.source = column.source ? `${column.source} · ${column.debtFree}` : column.debtFree;
  }

  return {
    name: friendlyName(preview.state.household.household_name),
    title: `Your plan: ${plainPlanName(selected.scenario)}`,
    advisor: preview.state.household.advisor,
    date: formatDate(AS_OF),
    estimated,
    leftOut,
    today,
    plan,
    interestSaved: interestSaved(today, plan),
    monthsSooner: monthsSooner(today.months, plan.months),
    loan: loanSentence(selected.scenario),
    advantages: notes.advantages,
    thingsToKnow: notes.thingsToKnow,
    columns,
    choices: choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      savedId: choice.savedId,
      draft: toDraft(choice.scenario),
    })),
    selectedId: selected.id,
  };
}
