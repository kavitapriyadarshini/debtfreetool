import { getHousehold } from "./data";
import { runScenario, type CaseState } from "./engine/scenario";
import { formatDate, formatMoney, formatMonths } from "./format";
import { listOpportunities } from "./opportunity";
import type { Case, CaseHistoryEvent, ContactEvent, Household, Scenario } from "./types";

export type FirmStage = "opportunity" | "cased" | "proposed" | "agreed";

export type FirmHousehold = {
  householdId: string;
  name: string;
  advisor: string;
  branch: string;
  /** Months the agreed plan saves. "from never" when today's payments never finish. */
  monthsSaved: number | "from never" | null;
  interestSaved: number | null;
};

export type FunnelRow = {
  advisor: string;
  branch: string;
  opportunity: string[];
  cased: string[];
  proposed: string[];
  agreed: string[];
};

export type FirmView = {
  ready: FirmHousehold[];
  waiting: FirmHousehold[];
  progress: FirmHousehold[];
  funnel: FunnelRow[];
  agreed: FirmHousehold[];
  monthsSaved: number;
  fromNever: number;
  interestSaved: number | null;
};

export type FirmDrill =
  | { kind: "ready" | "waiting" | "progress" }
  | { kind: "funnel"; stage: FirmStage; advisor: string | null }
  | { kind: "agreed" | "months" | "interest" };

const EVENT_LABEL: Record<string, string> = {
  case_created: "Case opened",
  override: "Value edited for this case",
  data_issue_reported: "Data issue reported",
  extra_payment_added: "Extra payment added",
  scenario_added: "Scenario added",
  scenario_removed: "Scenario removed",
  scenario_updated: "Scenario updated",
  recommended: "Plan recommended",
  presented: "Plan presented",
  decision_agreed: "Agreed",
  decision_declined: "Declined",
  decision_undecided: "Left undecided",
  snapshot_frozen: "Snapshot saved",
  payment_alert_acknowledged: "Payment alert acknowledged",
  contact_logged: "Contact logged",
};

const CHANNEL_LABEL: Record<ContactEvent["channel"], string> = {
  servicing_call: "Servicing call",
  advisor_outreach: "Outreach",
  household_request: "Household request",
};

const OUTCOME_LABEL: Record<string, string> = {
  agreed: "Agreed",
  declined: "Declined",
  undecided: "Undecided",
  presented: "Presented",
  no_offer: "No offer",
};

function eventLabel(event: string): string {
  const known = EVENT_LABEL[event];
  if (known) return known;
  const words = event.split("_").filter((word) => word !== "");
  if (words.length === 0) return event;
  return words
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function latestCases(cases: readonly Case[]): Map<string, Case> {
  const map = new Map<string, Case>();
  for (const row of cases) map.set(row.household_id, row);
  return map;
}

function currentPath(caseId: string, householdId: string): Scenario {
  return {
    scenario_id: "draft",
    case_id: caseId,
    household_id: householdId,
    name: "Today",
    strategy: "current",
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

function agreedSavings(
  householdId: string,
  caseRow: Case,
  scenarios: readonly Scenario[],
  caseState: CaseState,
): { monthsSaved: number | "from never" | null; interestSaved: number | null } {
  const scenario = scenarios.find((row) => row.scenario_id === caseRow.recommended_scenario_id);
  if (!scenario) return { monthsSaved: null, interestSaved: null };
  const scoped = { ...caseState, overrides: caseState.overrides.filter((row) => row.case_id === caseRow.case_id) };
  const today = runScenario(householdId, scoped, currentPath(caseRow.case_id, householdId));
  const plan = runScenario(householdId, scoped, { ...scenario, case_id: caseRow.case_id });
  if (today.months == null && plan.months != null) return { monthsSaved: "from never", interestSaved: null };
  if (today.months == null || plan.months == null) return { monthsSaved: null, interestSaved: null };
  return {
    monthsSaved: today.months - plan.months,
    interestSaved: Math.round(today.totalInterest) - Math.round(plan.totalInterest),
  };
}

function blank(household: Household): FirmHousehold {
  return {
    householdId: household.household_id,
    name: household.household_name,
    advisor: household.advisor,
    branch: household.branch,
    monthsSaved: null,
    interestSaved: null,
  };
}

export function firmView(input: {
  households: readonly Household[];
  contacts: readonly ContactEvent[];
  cases: readonly Case[];
  scenarios: readonly Scenario[];
  caseState: CaseState;
  branch: string;
  advisor: string;
}): FirmView {
  const visible = input.households.filter((household) => {
    if (input.branch !== "all" && household.branch !== input.branch) return false;
    if (input.advisor !== "all" && household.advisor !== input.advisor) return false;
    return true;
  });
  const cases = latestCases(input.cases);
  const rows = listOpportunities(visible, input.contacts, input.cases);
  const byId = new Map(rows.map((row) => [row.householdId, row]));
  const ready: FirmHousehold[] = [];
  const waiting: FirmHousehold[] = [];
  const progress: FirmHousehold[] = [];
  const funnel = new Map<string, FunnelRow>();

  const ensure = (household: Household) => {
    const found = funnel.get(household.advisor);
    if (found) return found;
    const created: FunnelRow = {
      advisor: household.advisor,
      branch: household.branch,
      opportunity: [],
      cased: [],
      proposed: [],
      agreed: [],
    };
    funnel.set(household.advisor, created);
    return created;
  };

  for (const household of visible) {
    const row = byId.get(household.household_id);
    const card = blank(household);
    const stage = ensure(household);
    if (row && !row.noAction) {
      stage.opportunity.push(household.household_id);
      if (row.outreach === "ready") ready.push(card);
      else if (row.outreach === "waiting") waiting.push(card);
      else progress.push(card);
    }
    const caseRow = cases.get(household.household_id);
    if (!caseRow) continue;
    stage.cased.push(household.household_id);
    if (caseRow.status === "proposed") stage.proposed.push(household.household_id);
    if (caseRow.status === "agreed") stage.agreed.push(household.household_id);
  }

  const agreed: FirmHousehold[] = [];
  for (const household of visible) {
    const caseRow = cases.get(household.household_id);
    if (caseRow?.status !== "agreed") continue;
    const saved = agreedSavings(household.household_id, caseRow, input.scenarios, input.caseState);
    agreed.push({ ...blank(household), ...saved });
  }

  const sortName = (a: FirmHousehold, b: FirmHousehold) => a.name.localeCompare(b.name);
  ready.sort(sortName);
  waiting.sort(sortName);
  progress.sort(sortName);
  agreed.sort(sortName);

  let monthsSaved = 0;
  let fromNever = 0;
  let interest: number | null = null;
  for (const household of agreed) {
    if (household.monthsSaved === "from never") fromNever += 1;
    else if (typeof household.monthsSaved === "number") monthsSaved += household.monthsSaved;
    if (household.interestSaved != null) interest = (interest ?? 0) + household.interestSaved;
  }

  return {
    ready,
    waiting,
    progress,
    funnel: [...funnel.values()].sort((a, b) => a.branch.localeCompare(b.branch) || a.advisor.localeCompare(b.advisor)),
    agreed,
    monthsSaved,
    fromNever,
    interestSaved: interest,
  };
}

export function drillHouseholds(view: FirmView, drill: FirmDrill): FirmHousehold[] {
  if (drill.kind === "ready") return view.ready;
  if (drill.kind === "waiting") return view.waiting;
  if (drill.kind === "progress") return view.progress;
  if (drill.kind === "agreed" || drill.kind === "months" || drill.kind === "interest") return view.agreed;
  if (drill.kind !== "funnel") return [];
  const rows = drill.advisor == null ? view.funnel : view.funnel.filter((row) => row.advisor === drill.advisor);
  const ids = rows.flatMap((row) => row[drill.stage]);
  const known = new Map([...view.ready, ...view.waiting, ...view.progress, ...view.agreed].map((row) => [row.householdId, row]));
  return ids.map((id) => {
    const found = known.get(id);
    if (found) return found;
    const household = getHousehold(id);
    return {
      householdId: id,
      name: household?.household_name ?? id,
      advisor: household?.advisor ?? "",
      branch: household?.branch ?? "",
      monthsSaved: null,
      interestSaved: null,
    };
  });
}

export function firmHistory(input: {
  householdId: string;
  cases: readonly Case[];
  history: readonly CaseHistoryEvent[];
  contacts: readonly ContactEvent[];
}): {
  name: string;
  advisor: string;
  branch: string;
  caseStatus: string | null;
  history: { at: string; event: string; by: string; detail: string }[];
  contacts: { at: string; channel: string; outcome: string; advisor: string }[];
} | null {
  const household = getHousehold(input.householdId);
  if (!household) return null;
  const caseRow = latestCases(input.cases).get(input.householdId) ?? null;
  return {
    name: household.household_name,
    advisor: household.advisor,
    branch: household.branch,
    caseStatus: caseRow?.status ?? null,
    history: input.history
      .filter((event) => caseRow != null && event.case_id === caseRow.case_id)
      .slice()
      .sort((a, b) => b.seq - a.seq)
      .map((event) => ({
        at: formatDate(event.at),
        event: eventLabel(event.event),
        by: event.by,
        detail: event.note?.trim() ? event.note : "—",
      })),
    contacts: input.contacts
      .filter((contact) => contact.household_id === input.householdId)
      .slice()
      .sort((a, b) => b.contacted_at.localeCompare(a.contacted_at) || b.contact_id.localeCompare(a.contact_id))
      .map((contact) => ({
        at: formatDate(contact.contacted_at),
        channel: CHANNEL_LABEL[contact.channel],
        outcome: OUTCOME_LABEL[contact.outcome] ?? contact.outcome,
        advisor: contact.advisor,
      })),
  };
}

export function monthsSavedText(months: number, fromNever: number): string {
  const base = formatMonths(months);
  if (fromNever === 0) return base;
  const extra = fromNever === 1 ? "1 more, from a path that never clears" : `${fromNever} more, from paths that never clear`;
  return months === 0 ? extra : `${base}, and ${extra}`;
}

export function interestSavedText(interest: number | null): string {
  if (interest == null) return "—";
  return formatMoney(interest);
}
