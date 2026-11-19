import { AS_OF } from "./config";
import { caseInputs, nightlyOnCase, savingsAgainst } from "./case-inputs";
import { formatMoney, formatMonths, signedInterestSaved, signedMonthsSaved, NOT_COMPARABLE } from "./format";
import { pipelineFlags, pipelineOffers, pipelineResults } from "./data";
import { flags } from "./engine/household";
import { fastAppMiss, type FastAppMiss } from "./engine/offers";
import { outreachStatus } from "./engine/outreach";
import { householdWithCase } from "./engine/scenario";
import type {
  Case,
  CaseOverride,
  CaseStatus,
  ContactEvent,
  DataFlag,
  Household,
  OutreachStatus,
  PaymentAlert,
  PipelineResult,
} from "./types";

const PRODUCT_ORDER = ["FastApp", "HELOAN Yellow", "HELOAN Pink"] as const;

export type PlanType = "No loan" | "FastApp" | "HELOAN Yellow" | "HELOAN Pink";

export type OpportunityTab = OutreachStatus;

export type ProductFilter = "any" | (typeof PRODUCT_ORDER)[number];

export type OpportunityFilters = {
  product: ProductFilter;
  flags: "any" | "yes" | "no";
  caseStatus: "any" | "none" | CaseStatus;
  minMonths: number | null;
};

export type OpportunitySort = "months" | "interest" | "last_contacted" | "days_until_ready";

export const FLAG_LABEL: Record<DataFlag, string> = {
  zero_payment: "$0 monthly payment, not included in plans",
  zero_rate: "0% rate",
  payment_below_interest: "Payment is below the interest, so this debt never pays off",
  possible_duplicate: "Possible duplicate debt",
  no_fico_any_member: "No FICO score on file; 740 is used as an estimate",
  missing_comfort_zone: "Comfort zone is missing, so FastApp is not available",
  income_missing: "Income is missing",
  income_implausible: "Income looks like a monthly amount entered as annual",
  stale_property_value: "Property value is from before 2024",
  mortgage_unlinked: "Mortgage is not linked to a property",
};

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  in_progress: "In progress",
  proposed: "Proposed",
  agreed: "Agreed",
  declined: "Declined",
  undecided: "Undecided",
};

export type OpportunityRow = {
  householdId: string;
  name: string;
  monthsSaved: number | "from never";
  interestSaved: number | "n/a";
  /** Months the nightly best plan takes. Null when that plan also never finishes. */
  bestPlanMonths: number | null;
  /** The nightly best plan's own total interest, even when savings are not comparable. */
  bestPlanInterest: number;
  planType: PlanType;
  alert: PaymentAlert;
  paymentChangePct: number;
  currentMonthly: number;
  bestMonthly: number;
  products: string[];
  noOfferReason: string | null;
  flags: DataFlag[];
  caseStatus: CaseStatus | null;
  lastContacted: string | null;
  readyDate: string | null;
  daysUntilReady: number;
  outreach: OutreachStatus;
  noAction: boolean;
  /** Case corrections replaced the nightly savings figure. */
  updatedInCase: boolean;
  /** The nightly pipeline figure, shown when the row uses the case instead. */
  nightlyMonthsLabel: string | null;
  nightlyInterestLabel: string | null;
};

type IndexedPipeline = {
  results: Map<string, PipelineResult>;
  products: Map<string, string[]>;
  flags: Map<string, DataFlag[]>;
};

let indexed: IndexedPipeline | null = null;
const missReasons = new Map<string, string | null>();

function pipelineIndex(): IndexedPipeline {
  if (indexed) return indexed;
  const products = new Map<string, Set<string>>();
  for (const offer of pipelineOffers) {
    const found = products.get(offer.household_id) ?? new Set<string>();
    found.add(offer.product);
    products.set(offer.household_id, found);
  }
  const flags = new Map<string, DataFlag[]>();
  for (const flag of pipelineFlags) {
    const list = flags.get(flag.household_id) ?? [];
    if (!list.includes(flag.flag)) list.push(flag.flag);
    flags.set(flag.household_id, list);
  }
  indexed = {
    results: new Map(pipelineResults.map((row) => [row.household_id, row])),
    products: new Map(
      [...products].map(([id, names]) => [id, PRODUCT_ORDER.filter((product) => names.has(product))]),
    ),
    flags,
  };
  return indexed;
}

export function planType(bestPlan: string): PlanType {
  if (bestPlan.startsWith("HELOAN Pink")) return "HELOAN Pink";
  if (bestPlan.startsWith("HELOAN Yellow")) return "HELOAN Yellow";
  if (bestPlan.startsWith("FastApp")) return "FastApp";
  return "No loan";
}

export function describeFastAppMiss(miss: FastAppMiss | null): string | null {
  if (!miss) return null;
  if (miss.kind === "no_comfort_zone") return "Pre-approved for FastApp, but no comfort zone is on file.";
  if (miss.kind === "below_minimum") {
    const kind = miss.cardsOnly ? "cards" : "unsecured debt";
    return `Pre-approved for FastApp, but ${formatMoney(miss.amount)} of ${kind} is below the ${formatMoney(miss.minimum)} minimum.`;
  }
  if (miss.kind === "blended_rate") {
    return "Pre-approved for FastApp, but a loan would not lower the blended rate.";
  }
  return "Pre-approved for FastApp, but no debt has a rate high enough to refinance.";
}

function noOfferReason(result: PipelineResult): string | null {
  if (!result.fastapp_preapproved_no_offer) return null;
  const cached = missReasons.get(result.household_id);
  if (cached !== undefined) return cached;
  const reason = describeFastAppMiss(fastAppMiss(result.household_id));
  missReasons.set(result.household_id, reason);
  return reason;
}

export function monthsSavedLabel(
  row: Pick<OpportunityRow, "noAction" | "monthsSaved" | "bestPlanMonths">,
): string {
  if (row.noAction) return "No action needed";
  if (row.monthsSaved === "from never") return NOT_COMPARABLE;
  if (row.monthsSaved < 0) return signedMonthsSaved(row.monthsSaved);
  return formatMonths(row.monthsSaved);
}

/** Interest saved for the list. A current path that never finishes has no total to subtract. */
export function interestSavedLabel(row: Pick<OpportunityRow, "monthsSaved" | "interestSaved">): string {
  if (row.monthsSaved === "from never" || row.interestSaved === "n/a") return NOT_COMPARABLE;
  if (row.interestSaved < 0) return signedInterestSaved(row.interestSaved);
  return formatMoney(row.interestSaved);
}

function monthsRank(row: OpportunityRow): number {
  if (row.noAction) return Number.NEGATIVE_INFINITY;
  if (row.monthsSaved === "from never") return Number.POSITIVE_INFINITY;
  return row.monthsSaved;
}

function interestRank(row: OpportunityRow): number {
  return row.interestSaved === "n/a" ? Number.NEGATIVE_INFINITY : row.interestSaved;
}

function byId(a: OpportunityRow, b: OpportunityRow): number {
  return a.householdId.localeCompare(b.householdId, undefined, { numeric: true });
}

export function sortOpportunities(rows: readonly OpportunityRow[], sort: OpportunitySort): OpportunityRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (sort === "interest") {
      return interestRank(b) - interestRank(a) || monthsRank(b) - monthsRank(a) || byId(a, b);
    }
    if (sort === "last_contacted") {
      if (a.lastContacted == null && b.lastContacted != null) return -1;
      if (a.lastContacted != null && b.lastContacted == null) return 1;
      if (a.lastContacted != null && b.lastContacted != null && a.lastContacted !== b.lastContacted) {
        return a.lastContacted.localeCompare(b.lastContacted);
      }
      return byId(a, b);
    }
    if (sort === "days_until_ready") {
      return a.daysUntilReady - b.daysUntilReady || byId(a, b);
    }
    return monthsRank(b) - monthsRank(a) || interestRank(b) - interestRank(a) || byId(a, b);
  });
  return copy;
}

export function filterOpportunities(
  rows: readonly OpportunityRow[],
  filters: OpportunityFilters,
): OpportunityRow[] {
  return rows.filter((row) => {
    if (filters.product !== "any" && !row.products.includes(filters.product)) return false;
    if (filters.flags === "yes" && row.flags.length === 0) return false;
    if (filters.flags === "no" && row.flags.length > 0) return false;
    if (filters.caseStatus === "none" && row.caseStatus != null) return false;
    if (filters.caseStatus !== "any" && filters.caseStatus !== "none" && row.caseStatus !== filters.caseStatus) {
      return false;
    }
    if (filters.minMonths != null) {
      const saved = row.monthsSaved === "from never" ? Number.POSITIVE_INFINITY : row.monthsSaved;
      if (saved < filters.minMonths) return false;
    }
    return true;
  });
}

export function nextReadyDate(rows: readonly OpportunityRow[]): string | null {
  let next: string | null = null;
  for (const row of rows) {
    if (row.outreach !== "waiting" || row.readyDate == null) continue;
    if (next == null || row.readyDate < next) next = row.readyDate;
  }
  return next;
}

/** Nightly pipeline joined with this demo's contacts and cases. Source JSON is not changed. */
export function listOpportunities(
  visible: readonly Household[],
  contacts: readonly ContactEvent[],
  cases: readonly Case[],
  overrides: readonly CaseOverride[] = [],
): OpportunityRow[] {
  const snapshot = pipelineIndex();
  const contactsByHousehold = new Map<string, ContactEvent[]>();
  for (const contact of contacts) {
    const list = contactsByHousehold.get(contact.household_id);
    if (list) list.push(contact);
    else contactsByHousehold.set(contact.household_id, [contact]);
  }
  const caseByHousehold = new Map<string, Case>();
  for (const caseRecord of cases) caseByHousehold.set(caseRecord.household_id, caseRecord);

  const rows: OpportunityRow[] = [];
  for (const household of visible) {
    const result = snapshot.results.get(household.household_id);
    if (!result) continue;
    const outreach = outreachStatus(contactsByHousehold.get(household.household_id) ?? [], AS_OF);
    const fresh = caseSavings(household.household_id, caseByHousehold.get(household.household_id), overrides);
    const monthsSaved = fresh?.monthsSaved ?? result.months_saved;
    const interestSaved = fresh?.interestSaved ?? result.interest_saved;
    rows.push({
      householdId: household.household_id,
      name: household.household_name,
      monthsSaved,
      interestSaved,
      bestPlanMonths: result.best_plan_months === "never" ? null : result.best_plan_months,
      bestPlanInterest: result.best_plan_interest,
      planType: planType(result.best_plan),
      alert: result.best_plan_payment_alert,
      paymentChangePct: result.best_plan_payment_change_pct,
      currentMonthly: result.current_monthly,
      bestMonthly: result.best_plan_monthly,
      products: snapshot.products.get(household.household_id) ?? [],
      noOfferReason: noOfferReason(result),
      flags: caseFlags(household.household_id, caseByHousehold.get(household.household_id), overrides, snapshot),
      caseStatus: caseByHousehold.get(household.household_id)?.status ?? null,
      lastContacted: outreach.last_contacted_at,
      readyDate: outreach.eligible_for_outreach_from,
      daysUntilReady: outreach.days_until_eligible,
      outreach: outreach.outreach_status,
      noAction: result.status === "no_action_needed" && fresh == null,
      updatedInCase: fresh != null,
      nightlyMonthsLabel: fresh ? pipelineMonthsLabel(result) : null,
      nightlyInterestLabel: fresh ? pipelineInterestLabel(result) : null,
    });
  }
  return rows;
}

function pipelineMonthsLabel(result: PipelineResult): string {
  if (result.months_saved === "from never") return NOT_COMPARABLE;
  return formatMonths(result.months_saved);
}

function pipelineInterestLabel(result: PipelineResult): string {
  if (result.months_saved === "from never" || result.interest_saved === "n/a") return NOT_COMPARABLE;
  return formatMoney(result.interest_saved);
}

/** Flags on the case's confirmed facts. Source flags stay when the case has not edited them. */
function caseFlags(
  householdId: string,
  caseRecord: Case | undefined,
  overrides: readonly CaseOverride[],
  snapshot: IndexedPipeline,
): DataFlag[] {
  const nightly = snapshot.flags.get(householdId) ?? [];
  if (!caseRecord) return nightly;
  const facts = overrides.filter((row) => row.case_id === caseRecord.case_id);
  if (facts.length === 0) return nightly;
  const state = householdWithCase(householdId, { overrides: facts, extraPayments: [], customLoans: [] });
  const live: DataFlag[] = [];
  for (const hit of flags(state.household, state.members, state.debts, state.properties)) {
    if (!live.includes(hit.flag)) live.push(hit.flag);
  }
  return live;
}

/** Savings of the nightly plan recalculated on the case's confirmed facts. */
function caseSavings(
  householdId: string,
  caseRecord: Case | undefined,
  overrides: readonly CaseOverride[],
): { monthsSaved: number | "from never"; interestSaved: number | "n/a" } | null {
  if (!caseRecord) return null;
  const facts = overrides.filter((row) => row.case_id === caseRecord.case_id);
  if (facts.length === 0) return null;
  const inputs = caseInputs(householdId, facts);
  if (!inputs) return null;
  const nightly = pipelineIndex().results.get(householdId);
  if (!nightly) return null;
  const plan = nightlyOnCase(inputs, nightly.best_plan);
  if (!plan) return null;
  return savingsAgainst(inputs.current, plan);
}
