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
  payoffMonths: Record<string, number>;
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
      else if (override.field === "balance" && typeof value === "number") debt.balance = value;
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

const scenarioCache = new Map<string, ScenarioRun>();
let scenarioComputes = 0;

function householdKey(household: string | Household | WorkingHousehold): string {
  if (typeof household === "string") return household;
  if ("household_id" in household) return `row:${household.household_id}`;
  const home = household.household;
  const debts = household.debts
    .map((debt) => [debt.debt_id, debt.balance, debt.rate, debt.monthly_payment, debt.property_id].join(","))
    .join(";");
  const members = household.members.map((member) => [member.member_id, member.fico].join(",")).join(";");
  const properties = household.properties
    .map((property) => [property.property_id, property.value, property.value_as_of].join(","))
    .join(";");
  return [home.household_id, home.comfort_zone, home.home_state, home.annual_income, debts, members, properties].join("|");
}

function scenarioKey(household: string | Household | WorkingHousehold, caseState: CaseState, scenario: Scenario): string {
  const overrides = caseState.overrides
    .filter((row) => row.case_id === scenario.case_id)
    .map((row) => [row.entity_type, row.entity_id, row.field, String(row.override_value)].join(":"))
    .sort()
    .join(";");
  const extras = caseState.extraPayments
    .filter((row) => row.case_id === scenario.case_id)
    .map((row) => [row.extra_id, row.type, row.amount, row.start_month, row.end_month].join(":"))
    .sort()
    .join(";");
  const loans = caseState.customLoans
    .filter((row) => row.case_id === scenario.case_id)
    .map((row) => [row.custom_loan_id, row.rate, row.term_months, row.max_amount].join(":"))
    .sort()
    .join(";");
  return [
    householdKey(household),
    scenario.scenario_id,
    scenario.strategy,
    scenario.loan_source,
    scenario.product,
    scenario.term_months,
    scenario.loan_amount,
    scenario.loan_rate,
    scenario.debts_paid_off,
    scenario.extra_payment_ids,
    overrides,
    extras,
    loans,
  ].join("~");
}

/** Drops memoised scenario results. Tests use this so one file does not reuse another's runs. */
export function resetScenarioCache(): void {
  scenarioCache.clear();
  scenarioComputes = 0;
}

/** How many scenario runs missed the cache since the last reset. */
export function scenarioComputeCount(): number {
  return scenarioComputes;
}

/**
 * Runs one advisor scenario on the household after this case's edits.
 * Debt payment, rate and exclusion change the simulation. Property value,
 * FICO, mortgage link and comfort zone are applied and eligibility is rebuilt.
 * The same inputs return the previous result instead of simulating again.
 */
export function runScenario(
  household: string | Household | WorkingHousehold,
  caseState: CaseState,
  scenario: Scenario,
): ScenarioRun {
  const key = scenarioKey(household, caseState, scenario);
  const cached = scenarioCache.get(key);
  if (cached) return cached;
  scenarioComputes += 1;
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

  const result: ScenarioRun = {
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
    payoffMonths: simulated.payoffMonths,
    offers,
  };
  scenarioCache.set(key, result);
  return result;
}
