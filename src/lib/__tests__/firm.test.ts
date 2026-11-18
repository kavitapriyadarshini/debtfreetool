import { describe, expect, it } from "vitest";
import { caseHistory, caseOverrides, cases, contacts, customLoans, extraPayments, households, scenarios } from "../data";
import { drillHouseholds, firmHistory, firmView } from "../firm";
import { listOpportunities } from "../opportunity";

const state = { overrides: caseOverrides, extraPayments, customLoans };

function view(branch = "all", advisor = "all") {
  return firmView({
    households,
    contacts,
    cases,
    scenarios,
    caseState: state,
    branch,
    advisor,
  });
}

describe("firm view", () => {
  it("matches the store for opportunity, the funnel, and agreed plans", () => {
    const model = view();
    const opportunities = listOpportunities(households, contacts, cases).filter((row) => !row.noAction);
    expect(model.ready.length + model.waiting.length + model.progress.length).toBe(opportunities.length);
    expect(model.ready.length).toBe(opportunities.filter((row) => row.outreach === "ready").length);
    expect(model.waiting.length).toBe(opportunities.filter((row) => row.outreach === "waiting").length);
    expect(model.progress.length).toBe(opportunities.filter((row) => row.outreach === "progress_check_due").length);

    const latest = new Map<string, (typeof cases)[number]>();
    for (const row of cases) latest.set(row.household_id, row);
    const agreedIds = [...latest.values()].filter((row) => row.status === "agreed").map((row) => row.household_id);
    const proposedIds = [...latest.values()].filter((row) => row.status === "proposed").map((row) => row.household_id);
    expect(model.funnel.reduce((sum, row) => sum + row.agreed.length, 0)).toBe(agreedIds.length);
    expect(model.funnel.reduce((sum, row) => sum + row.proposed.length, 0)).toBe(proposedIds.length);
    expect(model.funnel.reduce((sum, row) => sum + row.cased.length, 0)).toBe(latest.size);
    expect(model.agreed.map((row) => row.householdId).sort()).toEqual([...agreedIds].sort());
    expect(model.funnel.reduce((sum, row) => sum + row.opportunity.length, 0)).toBe(opportunities.length);

    const spoken = JSON.stringify(model).toLowerCase();
    expect(spoken).not.toContain("referral");
    expect(spoken).not.toContain("loan_amount");
  });

  it("filters to one advisor and drills into that advisor's agreed households", () => {
    const model = view("North Branch", "Pamela Wilson");
    expect(model.funnel.map((row) => row.advisor)).toEqual(["Pamela Wilson"]);
    expect(model.waiting.some((row) => row.householdId === "H01")).toBe(true);
    const agreed = drillHouseholds(model, { kind: "funnel", stage: "agreed", advisor: "Pamela Wilson" });
    expect(agreed.map((row) => row.householdId)).toContain("H01");
    const h01 = model.agreed.find((row) => row.householdId === "H01");
    expect(h01).toMatchObject({ monthsSaved: 114, interestSaved: 107710 });
    expect(model.monthsSaved).toBe(
      model.agreed.reduce((sum, row) => sum + (typeof row.monthsSaved === "number" ? row.monthsSaved : 0), 0),
    );
  });

  it("opens a household's case and contact history without loan amounts", () => {
    const detail = firmHistory({ householdId: "H01", cases, history: caseHistory, contacts });
    expect(detail?.caseStatus).toBe("agreed");
    expect(detail?.history.some((event) => event.event === "Agreed")).toBe(true);
    expect(detail?.contacts.length).toBeGreaterThan(0);
    const spoken = JSON.stringify(detail).toLowerCase();
    expect(spoken).not.toContain("referral");
    expect(spoken).not.toContain("loan_amount");
    expect(spoken).not.toMatch(/\$\d/);
  });
});
