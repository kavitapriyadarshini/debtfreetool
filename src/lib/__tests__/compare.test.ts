import { describe, expect, it } from "vitest";
import { compareFor, planDate } from "../compare";
import { caseOverrides, cases, customLoans, extraPayments, scenarios } from "../data";
import { workspaceFor } from "../workspace";

const state = { overrides: caseOverrides, extraPayments, customLoans };

function open(id: string, selected: string[]) {
  const caseRecord = [...cases].reverse().find((row) => row.household_id === id);
  return compareFor(id, caseRecord?.case_id ?? null, state, scenarios, selected);
}

describe("compare view", () => {
  it("suggests H01's Yellow 15-year and says why it won", () => {
    const model = workspaceFor("H01", "C0001", state, scenarios);
    const yellow = model?.choices.find((row) => row.label === "HELOAN Yellow 15-year");
    if (!yellow) throw new Error("Missing Yellow 15-year");
    const view = open("H01", [yellow.id]);
    expect(view?.suggestionName).toBe("HELOAN Yellow 15-year");
    expect(view?.why).toBe(
      "5 months sooner and $18,200 less interest than paying smarter without a loan. Secured on your home.",
    );
    expect(view?.addedBaselines).toBe(true);
    expect(view?.columns.map((column) => column.name)).toEqual([
      "Avalanche",
      "Snowball",
      "HELOAN Yellow 15-year",
    ]);
    const loan = view?.columns.find((column) => column.name === "HELOAN Yellow 15-year");
    expect(loan).toMatchObject({
      debtFreeDate: "Aug 2037",
      monthsSaved: "111 months",
      interest: "$127,511",
      alert: "none",
      matchesSuggestion: true,
    });
    expect(loan?.points).toHaveLength(129);
    expect(loan?.payoff.map((step) => step.name)).toEqual([
      "Chase Sapphire",
      "Citi Double Cash",
      "SoFi Personal Loan",
      "New loan",
      "Toyota Financial",
      "Rocket Mortgage",
    ]);
    expect(planDate(1)).toBe("Dec 2026");
  });

  it("keeps a no-loan comparison to the plans that were selected", () => {
    const view = open("H01", ["avalanche"]);
    expect(view?.columns.map((column) => column.name)).toEqual(["Avalanche"]);
    expect(view?.addedBaselines).toBe(false);
  });

  it("names the tie-break when nothing else separates the plans", () => {
    const view = open("H12", ["current"]);
    expect(view?.suggestionName).toBe("Current path");
    expect(view?.why).toBe("Tied on time, interest, and payment.");
  });

  it("marks H11's FastApp 1-year as the suggestion with a red alert", () => {
    const model = workspaceFor("H11", "C0005", state, scenarios);
    const fast = model?.choices.find((row) => row.label === "FastApp 1-year");
    if (!fast) throw new Error("Missing FastApp 1-year");
    const view = open("H11", [fast.id]);
    const column = view?.columns.find((row) => row.name === "FastApp 1-year");
    expect(view?.suggestionName).toBe("FastApp 1-year");
    expect(column?.matchesSuggestion).toBe(true);
    expect(column?.alert).toBe("red");
    expect(column?.savedScenarioId).toBe("S0014");
  });

  it("says a plan that never finishes is never debt free", () => {
    const view = compareFor("H07", null, { overrides: [], extraPayments: [], customLoans: [] }, [], ["current"]);
    expect(view?.columns[0]?.note).toBe("Never debt free at these payments");
  });

  it("marks a home-equity column as estimated when the score is the default", () => {
    const empty = { overrides: [], extraPayments: [], customLoans: [] };
    const model = workspaceFor("H19", null, empty, []);
    const offer = model?.choices.find((row) => row.product.startsWith("HELOAN"));
    if (!offer) throw new Error("Missing home-equity offer");
    const view = compareFor("H19", null, empty, [], [offer.id]);
    const column = view?.columns.find((row) => row.name.startsWith("HELOAN"));
    expect(column?.note).toContain("estimated");
  });
});
