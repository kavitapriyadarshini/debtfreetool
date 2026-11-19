import { describe, expect, it } from "vitest";
import { AS_OF } from "../config";
import { planDecision } from "../decision";
import { caseOverrides, cases, contacts, customLoans, extraPayments, scenarios } from "../data";
import { loadHousehold } from "../engine/household";
import { outreachStatus } from "../engine/outreach";
import { buildHouseholdOverview } from "../household-overview";
import { SIMPLIFICATION_NOTE, sourceDiffers } from "../snapshot";

const state = { overrides: caseOverrides, extraPayments, customLoans };

function decide(householdId: string, outcome: "agreed" | "declined" | "undecided", channel: "servicing_call" | "advisor_outreach" | "household_request", reason = "") {
  const caseRow = [...cases].reverse().find((row) => row.household_id === householdId);
  const scenario = scenarios.find((row) => row.scenario_id === caseRow?.recommended_scenario_id);
  if (!caseRow || !scenario) throw new Error(`Missing ${householdId}`);
  return planDecision({
    caseRow,
    scenario,
    contacts,
    caseState: state,
    outcome,
    channel,
    reason,
    advisor: "Tom Brennan",
    contactId: "K99999",
    snapshotId: "N0001",
  });
}

describe("decision and snapshot", () => {
  it("agrees H07 without a loan and moves the ready date to 12 Feb 2027", () => {
    const planned = decide("H07", "agreed", "servicing_call");
    expect(planned?.contact).toMatchObject({
      contacted_at: AS_OF,
      channel: "servicing_call",
      initiated_by: "advisor",
      plan_presented: true,
      outcome: "agreed",
      includes_new_loan: false,
      inside_cooling_off_override_reason: null,
    });
    expect(planned?.events.map((event) => event.event)).toEqual([
      "decision_agreed",
      "contact_logged",
      "snapshot_frozen",
    ]);
    if (!planned) throw new Error("H07 agreement is missing");
    const outreach = outreachStatus(
      [...contacts.filter((contact) => contact.household_id === "H07"), planned.contact],
      AS_OF,
    );
    expect(outreach.outreach_status).toBe("waiting");
    expect(outreach.eligible_for_outreach_from).toBe("2027-02-12");
    expect(outreach.cooling_off_rule).toBe("agreed_no_loan_90d");
    const snapshot = planned?.snapshot;
    expect(snapshot?.plan.interest).not.toBe(snapshot?.today.interest);
    expect(snapshot?.loan).toBeNull();
    expect(snapshot?.estimated).toBe(false);
    expect(snapshot?.leftOut.join(" ")).toContain("Reverse Mortgage");
    expect(snapshot?.note).toBe(SIMPLIFICATION_NOTE);
    expect(snapshot?.schedule.length).toBeGreaterThan(0);
    expect(snapshot?.thingsToKnow.some((line) => line.endsWith("is not included in this plan."))).toBe(true);
    expect(snapshot?.years.length).toBeGreaterThan(0);
    expect(snapshot?.years[0]?.months[0]?.label).toBe("Dec 2026");
    expect(snapshot?.advisor).toBe("Tom Brennan");
    expect(snapshot?.frozen_at).toBe(AS_OF);
    if (!snapshot) throw new Error("H07 snapshot is missing");
    expect(sourceDiffers(snapshot, loadHousehold("H07"))).toBe(false);
  });

  it("requires a reason for outreach inside a waiting period and not for a household request", () => {
    expect(decide("H07", "agreed", "advisor_outreach")).toBeNull();
    const withReason = decide("H07", "agreed", "advisor_outreach", "They asked us to call back.");
    expect(withReason?.contact.inside_cooling_off_override_reason).toBe("They asked us to call back.");
    const request = decide("H07", "declined", "household_request");
    expect(request?.contact.initiated_by).toBe("household");
    expect(request?.snapshot).toBeNull();
    expect(request?.events.map((event) => event.event)).toEqual(["decision_declined", "contact_logged"]);
  });

  it("keeps the frozen figures when the source later differs", () => {
    const snapshot = decide("H07", "agreed", "servicing_call")?.snapshot;
    if (!snapshot) throw new Error("Missing snapshot");
    const interest = snapshot.plan.interest;
    const firstMonth = snapshot.years[0]?.months[0]?.payment;
    const changed = structuredClone(snapshot);
    const firstDebt = changed.inputs.debts[0];
    if (!firstDebt) throw new Error("H07 snapshot has no debts");
    firstDebt.balance += 500;
    expect(sourceDiffers(changed, loadHousehold("H07"))).toBe(true);
    expect(snapshot.plan.interest).toBe(interest);
    expect(snapshot.years[0]?.months[0]?.payment).toBe(firstMonth);
    const view = buildHouseholdOverview({
      householdId: "H07",
      caseId: "C0002",
      overrides: caseOverrides,
      contacts,
      history: [],
      snapshots: [changed],
    });
    expect(view?.dataChanged).toBe(true);
    const unchanged = buildHouseholdOverview({
      householdId: "H07",
      caseId: "C0002",
      overrides: caseOverrides,
      contacts,
      history: [],
      snapshots: [snapshot],
    });
    expect(unchanged?.dataChanged).toBe(false);
  });

  it("freezes a home loan as secured and starts a 12-month wait", () => {
    const planned = decide("H01", "agreed", "servicing_call");
    expect(planned?.snapshot?.loan).toBe("This plan includes a loan. It is secured on your home.");
    expect(planned?.snapshot?.planName).toBe(
      "Your recommended plan: Pay off your cards with a home equity loan, then clear the rest in order",
    );
    expect(planned?.snapshot?.interestSaved).toBe("$107,710");
    expect(planned?.snapshot?.dataEdits).toEqual([]);
    expect(planned?.snapshot?.payoff[0]?.when).toBe("Upon starting new plan (Dec 2026)");
    expect(planned?.snapshot?.payoff[0]?.debt).toBe("Chase Sapphire");
    expect(planned?.snapshot?.advantages).toEqual([
      "Debt free 9 years 6 months sooner.",
      "$107,710 less interest.",
      "5 debts become 3.",
    ]);
    expect(planned?.snapshot?.thingsToKnow).toContain(
      "The new loan is secured on your home, which is at risk if payments are missed.",
    );
    const lastYear = planned?.snapshot?.years.at(-1);
    expect(lastYear?.year).toBe(2037);
    expect(lastYear?.months.at(-1)?.balance).toBe("$0");
    expect(planned?.contact.includes_new_loan).toBe(true);
    if (!planned) throw new Error("H01 agreement is missing");
    const outreach = outreachStatus(
      [...contacts.filter((contact) => contact.household_id === "H01"), planned.contact],
      AS_OF,
    );
    expect(outreach.outreach_status).toBe("waiting");
    expect(outreach.eligible_for_outreach_from).toBe("2027-11-14");
  });
});
