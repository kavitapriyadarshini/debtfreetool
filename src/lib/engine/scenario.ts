import type {
  CaseOverride,
  CustomLoan,
  Debt,
  ExtraPayment,
  Household,
  Member,
  PaymentAlert,
  Property,
  Scenario,
} from "../types";
import { amortise } from "./amortise";
import { paymentAlert } from "./bestPlan";
import { asWorking, type WorkingHousehold } from "./household";
import { buildOffers, type BuiltOffer } from "./offers";
import { pythonRound } from "./round";
import { monthIndex, simulate, type ExtraInput, type ScheduleRow, type SimDebt } from "./simulate";

export type CaseState = {
  overrides: readonly CaseOverride[];
  extraPayments: readonly ExtraPayment[];
  customLoans: readonly CustomLoan[];
};

export type ScenarioRun = {
  months: number | null;
  totalInterest: number;
  monthly: number;
  contractualMonthly: number;
  requiredMonthly: number;
  todayMonthly: number;
  paymentChangePct: number;
  paymentAlert: PaymentAlert;
  schedule: ScheduleRow[];
  payoffOrder: string[];
  /** Rebuilt from the edited household, including after FICO, value, link or comfort-zone changes. */
  offers: BuiltOffer[];
};

function applyOverrides(
  state: WorkingHousehold,
  overrides: readonly CaseOverride[],
): { state: WorkingHousehold; excluded: Set<string> } {
  const household: Household = { ...state.household };
  const members: Member[] = state.members.map((member) => ({ ...member }));
  const debts: Debt[] = state.debts.map((debt) => ({ ...debt }));
  const properties: Property[] = state.properties.map((property) => ({ ...property }));
  const excluded = new Set<string>();

  for (const override of overrides) {
    const value = override.override_value;
    if (override.entity_type === "debt") {
      const debt = debts.find((row) => row.debt_id === override.entity_id);
      if (!debt) continue;
      if (override.field === "monthly_payment" && typeof value === "number") debt.monthly_payment = value;
      else if (override.field === "rate" && typeof value === "number") debt.rate = value;
      else if (override.field === "excluded" && value === true) excluded.add(debt.debt_id);
      else if (override.field === "property_id" && typeof value === "string") debt.property_id = value;
    } else if (override.entity_type === "property") {
      const property = properties.find((row) => row.property_id === override.entity_id);
      if (property && override.field === "value" && typeof value === "number") property.value = value;
    } else if (override.entity_type === "member") {
      const member = members.find((row) => row.member_id === override.entity_id);
      if (member && override.field === "fico" && typeof value === "number") member.fico = value;
    } else if (override.entity_type === "household" && override.field === "comfort_zone" && typeof value === "number") {
      household.comfort_zone = value;
    }
  }

  return {
    state: { household, members, debts, properties, fastAppApproved: state.fastAppApproved },
    excluded,
  };
}

function extrasFor(scenario: Scenario, payments: readonly ExtraPayment[]): ExtraInput[] {
  const ids = new Set((scenario.extra_payment_ids ?? "").split(";").filter((id) => id !== ""));
  return payments
    .filter((payment) => payment.case_id === scenario.case_id && ids.has(payment.extra_id))
    .map((payment) => ({
      type: payment.type,
      amount: payment.amount,
      startIndex: monthIndex(payment.start_month),
      endIndex: payment.end_month ? monthIndex(payment.end_month) : null,
    }));
}

/**
 * Case edits applied, with excluded debts still in the list.
 * Plans drop those debts; the household overview still has to show them.
 */
export function casePreview(
  household: string | Household | WorkingHousehold,
  overrides: readonly CaseOverride[],
): { state: WorkingHousehold; excluded: Set<string> } {
  return applyOverrides(asWorking(household), overrides);
}

/** A copy of the household with this case's edits applied. Source rows are left untouched. */
export function householdWithCase(
  household: string | Household | WorkingHousehold,
  caseState: CaseState,
): WorkingHousehold {
  const { state, excluded } = casePreview(household, caseState.overrides);
  return {
    ...state,
    debts: state.debts.filter((debt) => !excluded.has(debt.debt_id)),
  };
}

/**
 * Runs one advisor scenario on the household after this case's edits.
 * Debt payment, rate and exclusion change the simulation. Property value,
 * FICO, mortgage link and comfort zone are applied and eligibility is rebuilt.
 */
export function runScenario(
  household: string | Household | WorkingHousehold,
  caseState: CaseState,
  scenario: Scenario,
): ScenarioRun {
  const edited = householdWithCase(household, {
    ...caseState,
    overrides: caseState.overrides.filter((override) => override.case_id === scenario.case_id),
  });
  const debts = edited.debts;
  const offers = buildOffers(edited);

  const valid = debts.filter((debt) => debt.monthly_payment > 0);
  const today = valid.reduce((sum, debt) => sum + debt.monthly_payment, 0);
  const moved = new Set((scenario.debts_paid_off ?? "").split(";").filter((id) => id !== ""));
  const simDebts: SimDebt[] = valid
    .filter((debt) => !moved.has(debt.debt_id))
    .map((debt) => ({
      id: debt.debt_id,
      balance: debt.balance,
      rate: debt.rate,
      payment: debt.monthly_payment,
    }));

  const amount = scenario.loan_amount;
  const rate = scenario.loan_rate;
  const term = scenario.term_months;
  if (amount > 0 && rate != null && term != null) {
    simDebts.push({
      id: "NEW_LOAN",
      balance: amount,
      rate,
      payment: amortise(amount, rate, term),
    });
  }

  const contractual = simDebts.reduce((sum, debt) => sum + debt.payment, 0);
  const extras = extrasFor(scenario, caseState.extraPayments);
  const recurring = extras
    .filter((extra) => extra.type === "recurring")
    .reduce((sum, extra) => sum + extra.amount, 0);
  const pay = Math.max(today, contractual);
  const required = contractual + recurring;
  const simulated = simulate(simDebts, scenario.strategy, pay, extras);
  const rise = today ? Math.max(pay, required) / today - 1 : 0;

  return {
    months: simulated.months,
    totalInterest: simulated.totalInterest,
    monthly: pythonRound(pay),
    contractualMonthly: pythonRound(contractual),
    requiredMonthly: pythonRound(Math.max(pay, required)),
    todayMonthly: pythonRound(today),
    paymentChangePct: pythonRound(rise * 100, 1),
    paymentAlert: paymentAlert(Math.max(pay, required), today),
    schedule: simulated.schedule,
    payoffOrder: simulated.payoffOrder,
    offers,
  };
}
