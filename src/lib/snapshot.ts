import { loadHousehold, type WorkingHousehold } from "./engine/household";
import { runScenario, type CaseState } from "./engine/scenario";
import type { ScheduleRow } from "./engine/simulate";
import { formatMoney, planDate } from "./format";
import { presentFor, type PayoffRow } from "./present";
import type { CaseOverride, CustomLoan, Debt, ExtraPayment, Household, Member, Property, Scenario } from "./types";

/** The sentence printed on every one-pager. */
export const SIMPLIFICATION_NOTE =
  "Simplified maths: fixed payments, no loan fees, interest monthly. Figures are illustrative.";

export type FrozenInputs = {
  household: Household;
  members: Member[];
  debts: Debt[];
  properties: Property[];
};

export type FrozenFigures = {
  debtFree: string;
  interest: string;
  monthly: string;
};

/** One printed row. Words are fixed when the household agrees. */
export type FrozenMonth = {
  label: string;
  payment: string;
  interest: string;
  balance: string;
  cleared: string;
};

export type FrozenYear = {
  year: number;
  months: FrozenMonth[];
};

export type FrozenSnapshot = {
  snapshot_id: string;
  case_id: string;
  household_id: string;
  name: string;
  advisor: string;
  frozen_at: string;
  inputs: FrozenInputs;
  edits: {
    overrides: CaseOverride[];
    extraPayments: ExtraPayment[];
    customLoans: CustomLoan[];
  };
  scenario: Scenario;
  schedule: ScheduleRow[];
  today: FrozenFigures;
  plan: FrozenFigures;
  /** Household-facing title, for example "Your recommended plan: …". */
  planName: string;
  interestSaved: string;
  monthsSooner: string;
  loan: string | null;
  payoff: PayoffRow[];
  /** Rule 9 only, copied at the moment of agreement. */
  advantages: string[];
  thingsToKnow: string[];
  /** Household lines for case edits. Empty when the case had none. */
  dataEdits: string[];
  /** Month-by-month pages. Kept even when the full schedule is left out of storage. */
  years: FrozenYear[];
  leftOut: string[];
  estimated: boolean;
  note: string;
};

const PAID = 0.005;

function loanLabel(scenario: Scenario): string {
  if (scenario.product?.startsWith("HELOAN")) return "Home equity loan";
  return "New loan";
}

function debtName(id: string, names: Map<string, string>, loan: string, seen: Map<string, string>): string {
  const existing = seen.get(id);
  if (existing) return existing;
  const base = id === "NEW_LOAN" ? loan : (names.get(id) ?? "Debt");
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

/** Printed month rows from the schedule captured with the agreement. */
export function scheduleYears(
  schedule: readonly ScheduleRow[],
  names: Map<string, string>,
  scenario: Scenario,
): FrozenYear[] {
  const loan = loanLabel(scenario);
  const seen = new Map<string, string>();
  const moved = (scenario.debts_paid_off ?? "")
    .split(";")
    .filter((id) => id !== "" && names.has(id))
    .map((id) => debtName(id, names, loan, seen));
  const groups = new Map<number, FrozenMonth[]>();
  let first = true;
  for (const row of schedule) {
    const label = planDate(row.month);
    const year = Number(label.slice(-4));
    const cleared: string[] = [];
    if (first) {
      for (const name of moved) {
        if (!cleared.includes(name)) cleared.push(name);
      }
      first = false;
    }
    for (const debt of row.debts) {
      if (debt.openingBalance <= PAID || debt.closingBalance > PAID) continue;
      const name = debtName(debt.id, names, loan, seen);
      if (!cleared.includes(name)) cleared.push(name);
    }
    const months = groups.get(year) ?? [];
    months.push({
      label,
      payment: formatMoney(row.debts.reduce((sum, debt) => sum + debt.payment, 0)),
      interest: formatMoney(row.debts.reduce((sum, debt) => sum + debt.interest, 0)),
      balance: formatMoney(row.debts.reduce((sum, debt) => sum + debt.closingBalance, 0)),
      cleared: cleared.join(", "),
    });
    groups.set(year, months);
  }
  return [...groups.keys()]
    .sort((a, b) => a - b)
    .map((year) => ({ year, months: groups.get(year) ?? [] }));
}

function sourceKey(inputs: FrozenInputs): string {
  const household = inputs.household;
  const members = [...inputs.members]
    .sort((a, b) => a.member_id.localeCompare(b.member_id))
    .map((member) => [member.member_id, member.member_name, member.fico]);
  const debts = [...inputs.debts]
    .sort((a, b) => a.debt_id.localeCompare(b.debt_id))
    .map((debt) => [
      debt.debt_id,
      debt.debt_name,
      debt.debt_type,
      debt.balance,
      debt.rate,
      debt.monthly_payment,
      debt.property_id,
    ]);
  const properties = [...inputs.properties]
    .sort((a, b) => a.property_id.localeCompare(b.property_id))
    .map((property) => [
      property.property_id,
      property.address,
      property.property_type,
      property.value,
      property.value_as_of,
    ]);
  return JSON.stringify({
    name: household.household_name,
    state: household.home_state,
    comfort: household.comfort_zone,
    income: household.annual_income,
    members,
    debts,
    properties,
  });
}

/** True when the live source rows are not the rows frozen with the agreed plan. */
export function sourceDiffers(snapshot: FrozenSnapshot, live: WorkingHousehold): boolean {
  return sourceKey(snapshot.inputs) !== sourceKey(live);
}

export function buildSnapshot(input: {
  snapshotId: string;
  caseId: string;
  householdId: string;
  scenario: Scenario;
  caseState: CaseState;
  advisor: string;
  frozenAt: string;
}): FrozenSnapshot | null {
  let source: WorkingHousehold;
  try {
    source = loadHousehold(input.householdId);
  } catch {
    return null;
  }
  const model = presentFor(input.householdId, input.caseId, input.caseState, [input.scenario], input.scenario.scenario_id);
  if (!model) return null;
  const scoped: CaseState = {
    ...input.caseState,
    overrides: input.caseState.overrides.filter((row) => row.case_id === input.caseId),
  };
  const schedule = runScenario(input.householdId, scoped, { ...input.scenario, case_id: input.caseId }).schedule;
  const inputs: FrozenInputs = {
    household: structuredClone(source.household),
    members: structuredClone(source.members),
    debts: structuredClone(source.debts),
    properties: structuredClone(source.properties),
  };
  return {
    snapshot_id: input.snapshotId,
    case_id: input.caseId,
    household_id: input.householdId,
    name: model.name,
    advisor: input.advisor,
    frozen_at: input.frozenAt,
    inputs,
    edits: {
      overrides: structuredClone([...scoped.overrides]),
      extraPayments: structuredClone([...input.caseState.extraPayments.filter((row) => row.case_id === input.caseId)]),
      customLoans: structuredClone([...input.caseState.customLoans.filter((row) => row.case_id === input.caseId)]),
    },
    scenario: structuredClone(input.scenario),
    schedule,
    today: {
      debtFree: model.today.debtFree,
      interest: model.today.interest,
      monthly: model.today.monthly,
    },
    plan: {
      debtFree: model.plan.debtFree,
      interest: model.plan.interest,
      monthly: model.plan.monthly,
    },
    planName: model.title,
    interestSaved: model.interestSaved,
    monthsSooner: model.monthsSooner,
    loan: model.loan,
    payoff: model.plan.payoff,
    advantages: model.advantages,
    thingsToKnow: model.thingsToKnow,
    dataEdits: model.dataEdits,
    years: scheduleYears(schedule, new Map(inputs.debts.map((debt) => [debt.debt_id, debt.debt_name])), input.scenario),
    leftOut: model.leftOut,
    estimated: model.estimated,
    note: SIMPLIFICATION_NOTE,
  };
}
