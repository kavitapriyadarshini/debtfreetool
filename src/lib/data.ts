import caseHistoryJson from "../data/case_history.json";
import caseOverridesJson from "../data/case_overrides.json";
import casesJson from "../data/cases.json";
import contactHistoryJson from "../data/contact_history.json";
import customLoansJson from "../data/custom_loans.json";
import debtsJson from "../data/debts.json";
import extraPaymentsJson from "../data/extra_payments.json";
import fastAppListJson from "../data/fastapp_list.json";
import householdMembersJson from "../data/household_members.json";
import householdOutreachJson from "../data/household_outreach.json";
import householdsJson from "../data/households.json";
import loanProductsJson from "../data/loan_products.json";
import pipelineFlagsJson from "../data/pipeline_flags.json";
import pipelineOffersJson from "../data/pipeline_offers.json";
import pipelineResultsJson from "../data/pipeline_results.json";
import propertiesJson from "../data/properties.json";
import qaExpectedDataIssuesJson from "../data/qa_expected_data_issues.json";
import scenarioResultsJson from "../data/scenario_results.json";
import scenariosJson from "../data/scenarios.json";
import type {
  Case,
  CaseHistoryEvent,
  CaseOverride,
  ContactEvent,
  CustomLoan,
  Debt,
  ExtraPayment,
  FastAppApproval,
  Household,
  HouseholdOutreach,
  LoanProduct,
  Member,
  PipelineFlag,
  PipelineOffer,
  PipelineResult,
  Property,
  QaExpectedDataIssue,
  Scenario,
  ScenarioResult,
} from "./types";

function asRows<T>(rows: unknown): T[] {
  return rows as T[];
}

export const households = asRows<Household>(householdsJson);
export const members = asRows<Member>(householdMembersJson);
export const debts = asRows<Debt>(debtsJson);
export const properties = asRows<Property>(propertiesJson);
export const fastAppApprovals = asRows<FastAppApproval>(fastAppListJson);
export const loanProducts = asRows<LoanProduct>(loanProductsJson);
export const pipelineResults = asRows<PipelineResult>(pipelineResultsJson);
export const pipelineOffers = asRows<PipelineOffer>(pipelineOffersJson);
export const pipelineFlags = asRows<PipelineFlag>(pipelineFlagsJson);
export const cases = asRows<Case>(casesJson);
export const caseHistory = asRows<CaseHistoryEvent>(caseHistoryJson);
export const scenarios = asRows<Scenario>(scenariosJson);
export const scenarioResults = asRows<ScenarioResult>(scenarioResultsJson);
export const extraPayments = asRows<ExtraPayment>(extraPaymentsJson);
export const caseOverrides = asRows<CaseOverride>(caseOverridesJson);
export const customLoans = asRows<CustomLoan>(customLoansJson);
export const contacts = asRows<ContactEvent>(contactHistoryJson);
export const outreach = asRows<HouseholdOutreach>(householdOutreachJson);
export const qaExpectedDataIssues = asRows<QaExpectedDataIssue>(qaExpectedDataIssuesJson);

function groupBy<T>(rows: readonly T[], householdId: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = householdId(row);
    const list = grouped.get(id);
    if (list) list.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}

const householdById = new Map(households.map((household) => [household.household_id, household]));
const membersByHousehold = groupBy(members, (member) => member.household_id);
const debtsByHousehold = groupBy(debts, (debt) => debt.household_id);
const propertiesByHousehold = groupBy(properties, (property) => property.household_id);
const offersByHousehold = groupBy(pipelineOffers, (offer) => offer.household_id);
const flagsByHousehold = groupBy(pipelineFlags, (flag) => flag.household_id);
const outreachByHousehold = new Map(outreach.map((row) => [row.household_id, row]));
const fastAppHouseholds = new Set(fastAppApprovals.map((row) => row.household_id));

export function getHousehold(id: string): Household | undefined {
  return householdById.get(id);
}

export function membersOf(householdId: string): Member[] {
  return membersByHousehold.get(householdId) ?? [];
}

export function debtsOf(householdId: string): Debt[] {
  return debtsByHousehold.get(householdId) ?? [];
}

export function propertiesOf(householdId: string): Property[] {
  return propertiesByHousehold.get(householdId) ?? [];
}

export function offersOf(householdId: string): PipelineOffer[] {
  return offersByHousehold.get(householdId) ?? [];
}

export function flagsOf(householdId: string): PipelineFlag[] {
  return flagsByHousehold.get(householdId) ?? [];
}

export function outreachOf(householdId: string): HouseholdOutreach | undefined {
  return outreachByHousehold.get(householdId);
}

export function isFastAppApproved(householdId: string): boolean {
  return fastAppHouseholds.has(householdId);
}

export function productsFor(product: string): LoanProduct[] {
  return loanProducts.filter((row) => row.product === product);
}
