import { describe, expect, it } from "vitest";
import { compareFor, nextComparison, planDate } from "../compare";
import { caseOverrides, cases, customLoans, extraPayments, scenarios } from "../data";
import { NOT_COMPARABLE } from "../format";
import { NEVER_NOTE, workspaceFor } from "../workspace";

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
    expect(view?.suggestionName).toBe("HELOAN Yellow 15-yr + extras");
    expect(view?.why).toBe(
      "8 months sooner and $23,100 less interest than paying smarter without a loan, including a $5,000 lump sum in Apr 2027. Secured on your home.",
    );
    const bare = compareFor("H01", null, { overrides: [], extraPayments: [], customLoans: [] }, [], [yellow.id]);
    expect(bare?.suggestionName).toBe("HELOAN Yellow 15-year");
    expect(bare?.why).toBe(
      "5 months sooner and $18,200 less interest than paying smarter without a loan. Secured on your home.",
    );
    expect(view?.addedBaselines).toBe(true);
    expect(view?.columns.map((column) => column.name)).toEqual([
      "Current path",
      "Avalanche",
      "Snowball",
      "HELOAN Yellow 15-year",
    ]);
    expect(view?.columns.find((column) => column.name === "HELOAN Yellow 15-year")?.moneyGoes[0]).toBe(
      "New loan of $35,000 pays off Chase, Citi and SoFi; their $1,050 a month stops; the loan's $332 starts; the other $718 goes to the new loan, the highest rate left.",
    );
    expect(view?.columns[0]?.badges).toContain("Today");
    expect(view?.columns.filter((column) => column.badges.includes("Nightly best"))).toHaveLength(1);
    expect(view?.columns.find((column) => column.badges.includes("Nightly best"))?.name).toBe(
      "HELOAN Yellow 15-year",
    );
    const loan = view?.columns.find((column) => column.name === "HELOAN Yellow 15-year");
    expect(loan).toMatchObject({
      debtFreeDate: "Aug 2037",
      monthsSaved: "111 months",
      interest: "$127,511",
      interestSaved: "$102,847",
      alert: "none",
      matchesSuggestion: false,
    });
    expect(view?.columns[0]?.recommendable).toBe(false);
    expect(loan?.points).toHaveLength(129);
    expect(loan?.payoff.map((step) => step.name)).toEqual([
      "Chase Sapphire · 24.99%",
      "Citi Double Cash · 21.5%",
      "SoFi Personal Loan · 13%",
      "New loan · HELOAN Yellow · 7.875%",
      "Toyota Financial · 6.9%",
      "Rocket Mortgage · 6.25%",
    ]);
    expect(planDate(1)).toBe("Dec 2026");
  });

  it("keeps a no-loan comparison to the plans that were selected", () => {
    const view = open("H01", ["avalanche"]);
    expect(view?.columns.map((column) => column.name)).toEqual(["Current path", "Avalanche"]);
    expect(view?.addedBaselines).toBe(false);
  });

  it("names the tie-break when nothing else separates the plans", () => {
    const view = compareFor("H12", null, { overrides: [], extraPayments: [], customLoans: [] }, [], ["current"]);
    expect(view?.suggestionName).toBe("Current path");
    expect(view?.why).toBe("Tied on time, interest, and payment.");
    expect(view?.columns[0]?.recommendable).toBe(true);
  });

  it("marks H11's FastApp 1-year as the suggestion with a red alert", () => {
    const model = workspaceFor("H11", "C0005", state, scenarios);
    const fast = model?.choices.find((row) => row.label === "FastApp 1-year");
    if (!fast) throw new Error("Missing FastApp 1-year");
    const view = open("H11", [fast.id]);
    const column = view?.columns.find((row) => row.name === "FastApp 1-year (edited data)");
    expect(view?.suggestionName).toBe("FastApp 1-year (edited data)");
    expect(column?.matchesSuggestion).toBe(true);
    expect(column?.alert).toBe("red");
    expect(column?.savedScenarioId).toBe("S0014");
    expect(view?.why.endsWith("but raises the monthly payment by $2,258 (+191%).")).toBe(true);
  });

  it("keeps today first and adds the suggestion until three plans are compared", () => {
    const two = open("H55", ["avalanche", "snowball"]);
    expect(two?.columns.map((column) => column.name)[0]).toBe("Current path (edited data)");
    expect(two?.columns[0]?.monthly).toBe("$3,408; $2,086 from Mar 2028; $1,396 from Apr 2029; $569 from Oct 2029");
    const amex = two?.columns[0]?.payoff.find((step) => step.name.startsWith("Amex Gold"));
    expect(amex?.edits).toEqual([
      "$827 (was $307) · Household confirmed their actual monthly payment · Pamela Wilson, 21 Oct 2026",
    ]);
    expect(amex?.resolved).toBe(true);
    expect(two?.columns.find((column) => column.id === "avalanche")?.monthly).toBe("$3,408");
    expect(two?.columns.some((column) => column.id === two.suggestionId)).toBe(false);
    const added = nextComparison(two?.columns ?? [], two?.suggestionId ?? "");
    expect(added.replaced).toBeNull();
    expect(added.ids).toContain(two?.suggestionId);
    const full = open("H55", added.ids);
    expect(full?.columns[0]?.name).toBe("Current path (edited data)");
    expect(full?.columns.filter((column) => column.id !== "current")).toHaveLength(3);
    expect(full?.columns.some((column) => column.id === full.suggestionId)).toBe(true);

    const crowded = nextComparison(
      [
        { id: "current", name: "Current path", monthsSavedCount: 0 },
        { id: "slow", name: "Slow plan", monthsSavedCount: 2 },
        { id: "mid", name: "Middle plan", monthsSavedCount: 11 },
        { id: "fast", name: "Fast plan", monthsSavedCount: 20 },
      ],
      "suggestion",
    );
    expect(crowded.replaced).toBe("Slow plan");
    expect(crowded.ids).toEqual(["suggestion", "mid", "fast"]);
  });

  it("says a plan that never finishes is never debt free", () => {
    const view = compareFor("H07", null, { overrides: [], extraPayments: [], customLoans: [] }, [], ["avalanche"]);
    expect(view?.columns[0]?.name).toBe("Current path");
    expect(view?.columns[0]?.debtFreeDate).toBe(NEVER_NOTE);
    expect(view?.columns[0]?.note).toBe(NEVER_NOTE);
    expect(view?.columns[0]?.monthsSaved).toBe(NOT_COMPARABLE);
    expect(view?.columns[0]?.interest).toBe(NOT_COMPARABLE);
    expect(view?.columns.map((column) => column.monthsSaved).join(" ")).not.toMatch(/from never|n\/a|—/i);
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
