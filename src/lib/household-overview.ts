import { AS_OF } from "./config";
import { getHousehold, pipelineResults } from "./data";
import { flags, householdFico, loadHousehold, todayPayment, validDebts, type FlagHit } from "./engine/household";
import { fastAppMiss } from "./engine/offers";
import { outreachStatus } from "./engine/outreach";
import { casePreview, householdWithCase, runScenario } from "./engine/scenario";
import { simulate } from "./engine/simulate";
import { caseInputs, nightlyOnCase } from "./case-inputs";
import { formatDate, formatMoney, formatMonths, formatRate, neverComparableReason, signedInterestSaved, signedMonthsSaved } from "./format";
import { describeFastAppMiss } from "./opportunity";
import { sourceDiffers, type FrozenSnapshot } from "./snapshot";
import type {
  CaseHistoryEvent,
  CaseOverride,
  ContactEvent,
  CustomLoan,
  Debt,
  ExtraPayment,
  ParsedCell,
  Property,
  Scenario,
} from "./types";

export type EditKind = "money" | "rate" | "fico" | "comfort" | "property" | "exclude";

export type EditableField = {
  entityType: CaseOverride["entity_type"];
  entityId: string;
  field: string;
  label: string;
  kind: EditKind;
  sourceValue: ParsedCell;
  currentValue: ParsedCell;
  /** The source value in the same words the screen uses. */
  sourceText: string;
};

export type FieldNote = {
  text: string;
  /** A live data flag, a case edit that already addressed it, or a greyed-out debt. */
  tone: "flag" | "resolved" | "muted";
};

export type ShownOverride = {
  original: string;
  next: string;
  reason: string;
  by: string;
  at: string;
};

/** "$827 (was $307) · Household confirmed their actual monthly payment · Pamela Wilson, 21 Oct 2026". */
export function editedValueLine(text: string, override: ShownOverride): string {
  return `${text} (was ${override.original}) · ${override.reason} · ${override.by}, ${override.at}`;
}

export type ShownField = {
  text: string;
  notes: FieldNote[];
  override: ShownOverride | null;
  edit: EditableField | null;
  report: EditableField | null;
};

export const OVERVIEW_TABS = ["debts", "members", "properties", "contacts", "history"] as const;
export type OverviewTab = (typeof OVERVIEW_TABS)[number];

export const OVERVIEW_TAB_LABEL: Record<OverviewTab, string> = {
  debts: "Debts",
  members: "Members",
  properties: "Properties",
  contacts: "Contact history",
  history: "Case history",
};

export function overviewTab(value: string | undefined): OverviewTab {
  return OVERVIEW_TABS.includes(value as OverviewTab) ? (value as OverviewTab) : "debts";
}

export type PlanInPlay = {
  /** Recommended when a plan is marked, otherwise the nightly pipeline plan. */
  label: "Recommended" | "Pipeline recommended";
  /** Months and interest saved against today. Null when today's path never finishes. */
  months: string | null;
  interest: string | null;
  /** Tooltip when today's path never finishes. */
  note: string | null;
};

const OUTREACH_LABEL = {
  ready: "Ready to contact",
  waiting: "Waiting",
  progress_check_due: "Progress check due",
} as const;

export type HouseholdOverview = {
  householdId: string;
  name: string;
  advisor: string;
  branch: string;
  state: string;
  hasCase: boolean;
  waiting: string | null;
  outreach: string;
  /** Ready date, set only while the household is waiting. */
  readyDate: string | null;
  planInPlay: PlanInPlay;
  /** True when live source rows differ from the frozen agreed plan. */
  dataChanged: boolean;
  fastAppReason: string | null;
  comfort: ShownField;
  fico: {
    text: string;
    whose: string | null;
    /** Active warning. Null once a case edit has supplied a score. */
  flag: string | null;
  /** Set when the source had no score and this case now does. */
  resolved: string | null;
  overrides: ShownOverride[];
  };
  income: { text: string; note: string | null };
  members: { memberId: string; name: string; role: string; fico: ShownField }[];
  properties: {
    propertyId: string;
    address: string;
    type: string;
    value: ShownField;
    valueDate: string;
    stale: boolean;
  }[];
  debts: {
    debtId: string;
    name: string;
    type: string;
    balance: ShownField;
    grey: boolean;
    rowNotes: FieldNote[];
    payment: ShownField;
    rate: ShownField;
    link: ShownField | null;
    exclude: ShownField | null;
  }[];
  contacts: {
    id: string;
    date: string;
    advisor: string;
    channel: string;
    outcome: string;
    plan: string;
  }[];
  history: { seq: number; event: string; by: string; at: string; ref: string | null; note: string | null }[];
};

const SECURED = new Set(["Mortgage", "Home equity loan"]);

const EVENT_LABEL: Record<string, string> = {
  case_created: "Case opened",
  override: "Value edited for this case",
  data_issue_reported: "Data issue reported",
  extra_payment_added: "Extra payment added",
  scenario_added: "Scenario added",
  scenario_removed: "Scenario removed",
  recommended: "Plan recommended",
  presented: "Plan presented",
  decision_agreed: "Agreed",
  decision_declined: "Declined",
  decision_undecided: "Left undecided",
  snapshot_frozen: "Snapshot saved",
  payment_alert_shown_amber: "Payment alert shown: amber",
  payment_alert_shown_red: "Payment alert shown: red",
  payment_alert_shown_none: "Payment alert shown: none",
  payment_alert_acknowledged: "Payment alert acknowledged",
  contact_logged: "Contact logged",
};

const CHANNEL_LABEL: Record<ContactEvent["channel"], string> = {
  servicing_call: "Servicing call",
  advisor_outreach: "Advisor outreach",
  household_request: "Household request",
};

const OUTCOME_LABEL: Record<string, string> = {
  agreed: "Agreed",
  declined: "Declined",
  undecided: "Undecided",
  presented: "Presented",
  no_offer: "No offer",
};

function blank(value: ParsedCell): boolean {
  return value == null || value === "";
}

function formatKind(kind: EditKind, value: ParsedCell, addressOf: (id: string) => string): string {
  if (kind === "exclude") return value === true ? "Excluded" : "Included";
  if (blank(value)) {
    if (kind === "fico") return "No score";
    if (kind === "comfort") return "Not set";
    if (kind === "property") return "Not linked";
    return "—";
  }
  if (kind === "money") return formatMoney(Number(value));
  if (kind === "rate") return formatRate(Number(value));
  if (kind === "comfort") return `Zone ${value}`;
  if (kind === "property") return addressOf(String(value));
  return String(value);
}

function belowInterest(debt: Debt): boolean {
  return debt.monthly_payment > 0 && debt.monthly_payment < (debt.balance * debt.rate) / 1200;
}

const RESOLVED_NOTE: FieldNote = { text: "Resolved in this case", tone: "resolved" };

function flagGone(sourceHits: readonly FlagHit[], caseHits: readonly FlagHit[], flag: FlagHit["flag"], entityId: string): boolean {
  const had = sourceHits.some((hit) => hit.flag === flag && hit.entityId === entityId);
  const has = caseHits.some((hit) => hit.flag === flag && hit.entityId === entityId);
  return had && !has;
}

function duplicateGone(sourceHits: readonly FlagHit[], caseHits: readonly FlagHit[], debtId: string): boolean {
  const mentions = (hit: FlagHit) => hit.flag === "possible_duplicate" && hit.entityId.split(";").includes(debtId);
  return sourceHits.some(mentions) && !caseHits.some(mentions);
}

function withResolved(notes: FieldNote[], gone: boolean): FieldNote[] {
  if (!gone || notes.some((note) => note.text === RESOLVED_NOTE.text)) return notes;
  return [...notes, RESOLVED_NOTE];
}

function latestOverride(
  overrides: readonly CaseOverride[],
  entityType: CaseOverride["entity_type"],
  entityId: string,
  field: string,
): CaseOverride | undefined {
  const matches = overrides.filter(
    (row) => row.entity_type === entityType && row.entity_id === entityId && row.field === field,
  );
  return matches[matches.length - 1];
}

function fieldOf(input: {
  kind: EditKind;
  entityType: CaseOverride["entity_type"];
  entityId: string;
  field: string;
  label: string;
  sourceValue: ParsedCell;
  currentValue: ParsedCell;
  record: CaseOverride | undefined;
  notes: FieldNote[];
  canEdit: boolean;
  addressOf: (id: string) => string;
}): ShownField {
  const editable: EditableField = {
    entityType: input.entityType,
    entityId: input.entityId,
    field: input.field,
    label: input.label,
    kind: input.kind,
    sourceValue: input.sourceValue,
    currentValue: input.currentValue,
    sourceText: formatKind(input.kind, input.sourceValue, input.addressOf),
  };
  const record = input.record;
  return {
    text: formatKind(input.kind, input.currentValue, input.addressOf),
    notes: input.notes,
    override: record
      ? {
          original: formatKind(input.kind, record.source_value, input.addressOf),
          next: formatKind(input.kind, record.override_value, input.addressOf),
          reason: record.reason,
          by: record.changed_by,
          at: formatDate(record.changed_at),
        }
      : null,
    edit: input.canEdit ? editable : null,
    report: editable,
  };
}

function whoseScore(names: string[]): string {
  if (names.length === 1) return `Using ${names[0]}'s score`;
  if (names.length === 2) return `Using ${names[0]}'s and ${names[1]}'s scores`;
  const last = names[names.length - 1] ?? "";
  return `Using ${names.slice(0, -1).join(", ")}'s and ${last}'s scores`;
}

function offerOutcome(outcome: string | null, includedLoan: boolean | null): string {
  const word = (outcome && OUTCOME_LABEL[outcome]) || outcome || "Recorded";
  if (outcome === "agreed" && includedLoan === true) return `${word}, with a new loan`;
  if (outcome === "agreed" && includedLoan === false) return `${word}, without a new loan`;
  return word;
}

function eventLabel(event: string): string {
  const known = EVENT_LABEL[event];
  if (known) return known;
  const words = event.split("_").filter((word) => word !== "");
  if (words.length === 0) return event;
  return words
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function addressOf(properties: readonly Property[]): (id: string) => string {
  const addresses = new Map(properties.map((property) => [property.property_id, property.address]));
  return (id) => addresses.get(id) ?? id;
}

function currentPath(debts: readonly Debt[]): { months: number | null; interest: number } {
  const valid = validDebts(debts);
  const pay = todayPayment(debts);
  const result = simulate(
    valid.map((debt) => ({
      id: debt.debt_id,
      balance: debt.balance,
      rate: debt.rate,
      payment: debt.monthly_payment,
    })),
    "current",
    pay,
    [],
    { schedule: false },
  );
  return { months: result.months, interest: result.totalInterest };
}

function planInPlay(input: {
  householdId: string;
  current: { months: number | null; interest: number };
  recommended: Scenario | undefined;
  caseState: { overrides: readonly CaseOverride[]; extraPayments: readonly ExtraPayment[]; customLoans: readonly CustomLoan[] };
}): PlanInPlay {
  const inputs = caseInputs(input.householdId, input.caseState.overrides);
  const current = inputs
    ? { months: inputs.current.months, interest: inputs.current.interest }
    : input.current;
  const nightly = pipelineResults.find((row) => row.household_id === input.householdId);
  const recommendedRun = input.recommended
    ? runScenario(input.householdId, input.caseState, input.recommended)
    : null;
  const recalculated = !recommendedRun && inputs && nightly ? nightlyOnCase(inputs, nightly.best_plan) : null;
  const planMonths = recommendedRun ? recommendedRun.months : (recalculated?.months ?? null);
  const planInterest = recommendedRun ? recommendedRun.totalInterest : (recalculated?.interest ?? 0);
  const label = input.recommended ? "Recommended" : "Pipeline recommended";
  if (current.months == null) {
    return {
      label,
      months: null,
      interest: null,
      note: neverComparableReason(planMonths == null ? null : formatMonths(planMonths)),
    };
  }
  if (planMonths == null) {
    return { label, months: null, interest: null, note: "This plan never clears these debts." };
  }
  const months = current.months - planMonths;
  const interest = Math.round(current.interest) - Math.round(planInterest);
  return {
    label,
    months: months < 0 ? signedMonthsSaved(months) : formatMonths(months),
    interest: signedInterestSaved(interest),
    note: null,
  };
}

/**
 * Household overview for S2. Case edits are applied for the values plans use,
 * and excluded debts stay in the list. Source rows are not modified.
 */
export function buildHouseholdOverview(input: {
  householdId: string;
  caseId: string | null;
  overrides: readonly CaseOverride[];
  contacts: readonly ContactEvent[];
  history: readonly CaseHistoryEvent[];
  snapshots?: readonly FrozenSnapshot[];
  /** Marked plan, when the case has one. Omitted means the nightly best is the plan in play. */
  recommendedScenarioId?: string | null;
  scenarios?: readonly Scenario[];
  extraPayments?: readonly ExtraPayment[];
  customLoans?: readonly CustomLoan[];
}): HouseholdOverview | null {
  if (!getHousehold(input.householdId)) return null;
  const source = loadHousehold(input.householdId);
  const caseOverrides = input.caseId
    ? input.overrides.filter((row) => row.case_id === input.caseId)
    : [];
  const { state, excluded } = casePreview(source, caseOverrides);
  const lookup = addressOf([...source.properties, ...state.properties]);
  const sourceFlags = flags(source.household, source.members, source.debts, source.properties);
  const plannedDebts = state.debts.filter((debt) => !excluded.has(debt.debt_id));
  const editedFlags = flags(state.household, state.members, plannedDebts, state.properties);
  const listedDuplicates = (hits: readonly FlagHit[]) => {
    const ids = new Set<string>();
    for (const hit of hits) {
      if (hit.flag !== "possible_duplicate") continue;
      for (const id of hit.entityId.split(";")) {
        if (id) ids.add(id);
      }
    }
    return ids;
  };
  const liveDuplicates = listedDuplicates(editedFlags);
  const knownDuplicates = listedDuplicates([...sourceFlags, ...editedFlags]);

  const sourceByDebt = new Map(source.debts.map((debt) => [debt.debt_id, debt]));
  const householdId = source.household.household_id;
  const fico = householdFico(state.members);
  const holders = state.members.filter((member) => member.fico != null && member.fico === fico.fico);

  const comfortRecord = latestOverride(caseOverrides, "household", householdId, "comfort_zone");
  const comfortNotes: FieldNote[] = [];
  if (state.household.comfort_zone == null) {
    comfortNotes.push({
      text: "Comfort zone is missing, so FastApp is not available",
      tone: "flag",
    });
  } else if (flagGone(sourceFlags, editedFlags, "missing_comfort_zone", "")) {
    comfortNotes.push(RESOLVED_NOTE);
  }

  const incomeNote = editedFlags.some((hit) => hit.flag === "income_missing")
    ? "Income is missing"
    : editedFlags.some((hit) => hit.flag === "income_implausible")
      ? "Income looks like a monthly amount entered as annual"
      : null;

  const contacts = input.contacts
    .filter((contact) => contact.household_id === householdId)
    .slice()
    .sort((a, b) => b.contacted_at.localeCompare(a.contacted_at) || b.contact_id.localeCompare(a.contact_id));
  const outreach = outreachStatus(contacts, AS_OF);
  const caseState = {
    overrides: caseOverrides,
    extraPayments: input.extraPayments ?? [],
    customLoans: input.customLoans ?? [],
  };
  const recommended = (input.scenarios ?? []).find(
    (scenario) => scenario.scenario_id === input.recommendedScenarioId,
  );
  const playing = planInPlay({
    householdId,
    current: currentPath(householdWithCase(householdId, caseState).debts),
    recommended,
    caseState,
  });
  const waiting =
    outreach.outreach_status === "waiting"
      ? [
          outreach.last_offer_at
            ? `Last offer on ${formatDate(outreach.last_offer_at)}: ${offerOutcome(outreach.last_offer_outcome, outreach.last_offer_included_loan)}.`
            : "No offer is on file.",
          outreach.eligible_for_outreach_from
            ? `Ready from ${formatDate(outreach.eligible_for_outreach_from)}.`
            : "Ready date is not on file.",
          "You can still work this case.",
        ].join(" ")
      : null;

  const planned = {
    ...state,
    debts: state.debts.filter((debt) => !excluded.has(debt.debt_id)),
  };

  return {
    householdId,
    name: state.household.household_name,
    advisor: state.household.advisor,
    branch: state.household.branch,
    state: state.household.home_state,
    hasCase: input.caseId != null,
    waiting,
    outreach: OUTREACH_LABEL[outreach.outreach_status],
    readyDate:
      outreach.outreach_status === "waiting" && outreach.eligible_for_outreach_from
        ? formatDate(outreach.eligible_for_outreach_from)
        : null,
    planInPlay: playing,
    dataChanged: (input.snapshots ?? []).some(
      (snapshot) => snapshot.household_id === input.householdId && sourceDiffers(snapshot, source),
    ),
    fastAppReason: describeFastAppMiss(fastAppMiss(planned)),
    comfort: fieldOf({
      kind: "comfort",
      entityType: "household",
      entityId: householdId,
      field: "comfort_zone",
      label: "Comfort zone",
      sourceValue: source.household.comfort_zone,
      currentValue: state.household.comfort_zone,
      record: comfortRecord,
      notes: comfortNotes,
      canEdit: true,
      addressOf: lookup,
    }),
    fico: {
      text: fico.defaulted ? "740, estimated" : String(fico.fico),
      whose: fico.defaulted ? null : whoseScore(holders.map((member) => member.member_name)),
      flag: fico.defaulted ? "No FICO score on file" : null,
      resolved:
        !fico.defaulted && flagGone(sourceFlags, editedFlags, "no_fico_any_member", "")
          ? RESOLVED_NOTE.text
          : null,
      overrides: holders.flatMap((member) => {
        const record = latestOverride(caseOverrides, "member", member.member_id, "fico");
        if (!record) return [];
        return [
          {
            original: formatKind("fico", record.source_value, lookup),
            next: formatKind("fico", record.override_value, lookup),
            reason: record.reason,
            by: record.changed_by,
            at: formatDate(record.changed_at),
          },
        ];
      }),
    },
    income: {
      text: state.household.annual_income == null ? "Missing" : formatMoney(state.household.annual_income),
      note: incomeNote,
    },
    members: state.members.map((member) => {
      const sourceMember = source.members.find((row) => row.member_id === member.member_id);
      const record = latestOverride(caseOverrides, "member", member.member_id, "fico");
      return {
        memberId: member.member_id,
        name: member.member_name,
        role: member.role,
        fico: fieldOf({
          kind: "fico",
          entityType: "member",
          entityId: member.member_id,
          field: "fico",
          label: `${member.member_name}'s FICO`,
          sourceValue: sourceMember?.fico ?? null,
          currentValue: member.fico,
          record,
          notes: withResolved(
            [],
            record != null && flagGone(sourceFlags, editedFlags, "no_fico_any_member", ""),
          ),
          canEdit: true,
          addressOf: lookup,
        }),
      };
    }),
    properties: state.properties.map((property) => {
      const sourceProperty = source.properties.find((row) => row.property_id === property.property_id);
      const stale = property.value_as_of < "2024-01-01";
      return {
        propertyId: property.property_id,
        address: property.address,
        type: property.property_type,
        valueDate: formatDate(property.value_as_of),
        stale,
        value: fieldOf({
          kind: "money",
          entityType: "property",
          entityId: property.property_id,
          field: "value",
          label: `${property.address} value`,
          sourceValue: sourceProperty?.value ?? property.value,
          currentValue: property.value,
          record: latestOverride(caseOverrides, "property", property.property_id, "value"),
          notes: stale ? [{ text: "Property value is from before 2024", tone: "flag" }] : [],
          canEdit: true,
          addressOf: lookup,
        }),
      };
    }),
    debts: state.debts.map((debt) => {
      const sourceDebt = sourceByDebt.get(debt.debt_id) ?? debt;
      const grey = debt.monthly_payment <= 0 || excluded.has(debt.debt_id);
      const rowNotes: FieldNote[] = [];
      if (grey) rowNotes.push({ text: "not included in plans", tone: "muted" });
      if (liveDuplicates.has(debt.debt_id)) rowNotes.push({ text: "possible duplicate", tone: "flag" });

      const paymentRecord = latestOverride(caseOverrides, "debt", debt.debt_id, "monthly_payment");
      const rateRecord = latestOverride(caseOverrides, "debt", debt.debt_id, "rate");
      const linkRecord = latestOverride(caseOverrides, "debt", debt.debt_id, "property_id");
      const excludeRecord = latestOverride(caseOverrides, "debt", debt.debt_id, "excluded");

      const paymentNotes = withResolved(
        belowInterest(debt) ? [{ text: "Never pays off", tone: "flag" as const }] : [],
        paymentRecord != null &&
          (flagGone(sourceFlags, editedFlags, "payment_below_interest", debt.debt_id) ||
            flagGone(sourceFlags, editedFlags, "zero_payment", debt.debt_id)),
      );

      const rateNotes = withResolved(
        debt.monthly_payment > 0 && debt.rate === 0
          ? [{ text: "Confirm or edit the rate", tone: "flag" as const }]
          : [],
        rateRecord != null && flagGone(sourceFlags, editedFlags, "zero_rate", debt.debt_id),
      );

      const secured = SECURED.has(debt.debt_type);
      const linkNotes = withResolved(
        secured && debt.monthly_payment > 0 && !debt.property_id
          ? [{ text: "Link this mortgage to a property", tone: "flag" as const }]
          : [],
        linkRecord != null && flagGone(sourceFlags, editedFlags, "mortgage_unlinked", debt.debt_id),
      );

      return {
        debtId: debt.debt_id,
        name: debt.debt_name,
    type: debt.debt_type,
    balance: fieldOf({
      kind: "money",
      entityType: "debt",
      entityId: debt.debt_id,
      field: "balance",
      label: `${debt.debt_name} balance`,
      sourceValue: sourceDebt.balance,
      currentValue: debt.balance,
      record: latestOverride(caseOverrides, "debt", debt.debt_id, "balance"),
      notes: [],
      canEdit: true,
      addressOf: lookup,
    }),
    grey,
        rowNotes,
        payment: fieldOf({
          kind: "money",
          entityType: "debt",
          entityId: debt.debt_id,
          field: "monthly_payment",
          label: `${debt.debt_name} monthly payment`,
          sourceValue: sourceDebt.monthly_payment,
          currentValue: debt.monthly_payment,
          record: paymentRecord,
          notes: paymentNotes,
          canEdit: true,
          addressOf: lookup,
        }),
        rate: fieldOf({
          kind: "rate",
          entityType: "debt",
          entityId: debt.debt_id,
          field: "rate",
          label: `${debt.debt_name} interest rate`,
          sourceValue: sourceDebt.rate,
          currentValue: debt.rate,
          record: rateRecord,
          notes: rateNotes,
          canEdit: true,
          addressOf: lookup,
        }),
        link: secured
          ? fieldOf({
              kind: "property",
              entityType: "debt",
              entityId: debt.debt_id,
              field: "property_id",
              label: `${debt.debt_name} property`,
              sourceValue: sourceDebt.property_id,
              currentValue: debt.property_id,
              record: linkRecord,
              notes: linkNotes,
              canEdit: true,
              addressOf: lookup,
            })
          : null,
        exclude: knownDuplicates.has(debt.debt_id)
          ? fieldOf({
              kind: "exclude",
              entityType: "debt",
              entityId: debt.debt_id,
              field: "excluded",
              label: `Exclude ${debt.debt_name}`,
              sourceValue: false,
              currentValue: excluded.has(debt.debt_id),
              record: excludeRecord,
              notes: withResolved([], excludeRecord != null && duplicateGone(sourceFlags, editedFlags, debt.debt_id)),
              canEdit: !excluded.has(debt.debt_id),
              addressOf: lookup,
            })
          : null,
      };
    }),
    contacts: contacts.map((contact) => ({
      id: contact.contact_id,
      date: formatDate(contact.contacted_at),
      advisor: contact.advisor,
      channel: CHANNEL_LABEL[contact.channel],
      outcome: OUTCOME_LABEL[contact.outcome] ?? contact.outcome,
      plan: contact.plan_presented ? "Plan presented" : "No plan presented",
    })),
    history: input.history
      .filter((event) => input.caseId != null && event.case_id === input.caseId)
      .slice()
      .sort((a, b) => b.seq - a.seq)
      .map((event) => ({
        seq: event.seq,
        event: eventLabel(event.event),
        by: event.by,
        at: formatDate(event.at),
        ref: event.ref_id,
        note: event.note?.trim() ? event.note : null,
      })),
  };
}
