import { loadHousehold, type WorkingHousehold } from "./engine/household";
import { runScenario, type CaseState } from "./engine/scenario";
import type { ScheduleRow } from "./engine/simulate";
import { presentFor } from "./present";
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
  interestSaved: string;
  monthsSooner: string;
  loan: string | null;
  payoff: { name: string; when: string }[];
  leftOut: string[];
  estimated: boolean;
  note: string;
};

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
    interestSaved: model.interestSaved,
    monthsSooner: model.monthsSooner,
    loan: model.loan,
    payoff: model.plan.payoff,
    leftOut: model.leftOut,
    estimated: model.estimated,
    note: SIMPLIFICATION_NOTE,
  };
}
