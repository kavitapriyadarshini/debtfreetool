import { AS_OF } from "./config";
import { outreachStatus } from "./engine/outreach";
import type { CaseState } from "./engine/scenario";
import { buildSnapshot, type FrozenSnapshot } from "./snapshot";
import type { Case, ContactChannel, ContactEvent, Decision, Scenario } from "./types";

export type DecisionRequest = {
  caseRow: Case;
  scenario: Scenario;
  contacts: readonly ContactEvent[];
  caseState: CaseState;
  outcome: Decision;
  channel: ContactChannel;
  reason: string;
  advisor: string;
  contactId: string;
  snapshotId: string;
};

export type PlannedDecision = {
  contact: ContactEvent;
  events: { event: string; refId: string | null; note?: string | null }[];
  snapshot: FrozenSnapshot | null;
};

/** Outreach during a waiting period needs a logged reason. A servicing call or household request does not. */
export function outreachReasonRequired(contacts: readonly ContactEvent[], householdId: string, channel: ContactChannel): boolean {
  if (channel !== "advisor_outreach") return false;
  const status = outreachStatus(
    contacts.filter((contact) => contact.household_id === householdId),
    AS_OF,
  );
  return status.outreach_status === "waiting";
}

/**
 * Contact, case-history events, and (for an agreement) the frozen snapshot.
 * Returns null when outreach is inside a waiting period and no reason was given.
 */
export function planDecision(input: DecisionRequest): PlannedDecision | null {
  if (outreachReasonRequired(input.contacts, input.caseRow.household_id, input.channel) && input.reason.trim() === "") {
    return null;
  }
  const includesNewLoan = input.scenario.loan_source !== "none" && input.scenario.loan_amount > 0;
  const reason = input.reason.trim();
  const contact: ContactEvent = {
    contact_id: input.contactId,
    household_id: input.caseRow.household_id,
    advisor: input.advisor,
    contacted_at: AS_OF,
    channel: input.channel,
    initiated_by: input.channel === "household_request" ? "household" : "advisor",
    plan_presented: true,
    outcome: input.outcome,
    includes_new_loan: includesNewLoan,
    case_id: input.caseRow.case_id,
    scenario_id: input.scenario.scenario_id,
    inside_cooling_off_override_reason: reason || null,
  };
  const snapshot =
    input.outcome === "agreed"
      ? buildSnapshot({
          snapshotId: input.snapshotId,
          caseId: input.caseRow.case_id,
          householdId: input.caseRow.household_id,
          scenario: input.scenario,
          caseState: input.caseState,
          advisor: input.advisor,
          frozenAt: AS_OF,
        })
      : null;
  if (input.outcome === "agreed" && !snapshot) return null;
  const events = [
    { event: `decision_${input.outcome}`, refId: input.scenario.scenario_id, note: null },
    { event: "contact_logged", refId: input.contactId, note: reason || null },
  ];
  if (snapshot) events.push({ event: "snapshot_frozen", refId: snapshot.snapshot_id, note: null });
  return { contact, events, snapshot };
}
