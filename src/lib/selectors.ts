import { AS_OF } from "./config";
import { households } from "./data";
import { builtInPlans, suggestion, type PlanOption, type PlanRisk } from "./engine/bestPlan";
import { flags, householdFico, loadHousehold } from "./engine/household";
import { buildOffers } from "./engine/offers";
import { outreachStatus } from "./engine/outreach";
import { householdWithCase, runScenario, type ScenarioRun } from "./engine/scenario";
import type { DemoState } from "./store";
import type { Case, Household, Scenario } from "./types";
import type { DemoUser } from "./users";

type DemoSlice = Pick<
  DemoState,
  "cases" | "caseHistory" | "scenarios" | "extraPayments" | "caseOverrides" | "customLoans" | "contacts"
>;

export function selectVisibleHouseholds(user: DemoUser): Household[] {
  if (user.role === "manager") return households;
  return households.filter((household) => household.advisor === user.name);
}

export function selectCase(state: DemoSlice, householdId: string): Case | undefined {
  const matches = state.cases.filter((row) => row.household_id === householdId);
  return matches[matches.length - 1];
}

export function selectCaseState(state: DemoSlice, caseId: string) {
  return {
    overrides: state.caseOverrides.filter((row) => row.case_id === caseId),
    extraPayments: state.extraPayments.filter((row) => row.case_id === caseId),
    customLoans: state.customLoans.filter((row) => row.case_id === caseId),
  };
}

function planRisk(scenario: Scenario): PlanRisk {
  if (scenario.loan_source === "none") return "none";
  if (scenario.product?.startsWith("HELOAN")) return "secured";
  return "unsecured";
}

function toPlan(scenario: Scenario, result: ScenarioRun): PlanOption {
  return {
    name: scenario.name,
    months: result.months,
    interest: result.totalInterest,
    contractual: result.contractualMonthly,
    risk: planRisk(scenario),
    schedule: result.schedule,
    payoffOrder: result.payoffOrder,
    payoffMonths: result.payoffMonths,
  };
}

/**
 * Source household plus this case's edits, scenarios and outreach.
 * Reads copies only. The bundled JSON is not modified.
 */
export function selectHouseholdView(state: DemoSlice, householdId: string) {
  const source = loadHousehold(householdId);
  const caseRecord = selectCase(state, householdId);
  const caseState = caseRecord
    ? selectCaseState(state, caseRecord.case_id)
    : { overrides: [], extraPayments: [], customLoans: [] };
  const edited = householdWithCase(source, caseState);
  const scenarioRows = caseRecord
    ? state.scenarios.filter((row) => row.case_id === caseRecord.case_id)
    : [];
  const runs = scenarioRows.map((scenario) => ({
    scenario,
    result: runScenario(edited, caseState, scenario),
  }));
  const plans = runs.map((run) => toPlan(run.scenario, run.result));
  const suggested = plans.length > 0 ? suggestion(plans) : null;
  const suggestedIndex = suggested ? plans.indexOf(suggested.plan) : -1;

  return {
    household: edited.household,
    members: edited.members,
    debts: edited.debts,
    properties: edited.properties,
    fico: householdFico(edited.members),
    flags: flags(edited.household, edited.members, edited.debts, edited.properties),
    builtIn: builtInPlans(edited),
    offers: buildOffers(edited),
    case: caseRecord,
    scenarios: runs,
    suggestion:
      suggested && suggestedIndex >= 0
        ? { scenario: runs[suggestedIndex]!.scenario, why: suggested.why, result: runs[suggestedIndex]!.result }
        : null,
    outreach: outreachStatus(
      state.contacts.filter((contact) => contact.household_id === householdId),
      AS_OF,
    ),
    history: caseRecord ? state.caseHistory.filter((row) => row.case_id === caseRecord.case_id) : [],
    contacts: state.contacts.filter((contact) => contact.household_id === householdId),
  };
}
