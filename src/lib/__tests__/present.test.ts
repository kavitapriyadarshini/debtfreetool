import { describe, expect, it } from "vitest";
import { caseOverrides, cases, customLoans, extraPayments, scenarios } from "../data";
import { presentFor } from "../present";

const state = { overrides: caseOverrides, extraPayments, customLoans };

function show(id: string, plan = "") {
  const caseRecord = [...cases].reverse().find((row) => row.household_id === id);
  return presentFor(id, caseRecord?.case_id ?? null, state, scenarios, plan);
}

const FORBIDDEN = ["avalanche", "snowball", "HELOAN", "FICO", "no_fico", "possible_duplicate", "payment alert"];

function householdText(model: NonNullable<ReturnType<typeof show>>): string {
  return [
    model.name,
    model.today.debtFree,
    model.today.interest,
    model.today.monthly,
    model.plan.debtFree,
    model.plan.interest,
    model.plan.monthly,
    model.interestSaved,
    model.monthsSooner,
    model.loan ?? "",
    ...model.leftOut,
    ...model.plan.payoff.flatMap((step) => [step.name, step.when]),
  ].join(" ");
}

describe("present mode", () => {
  it("shows H01 today beside the recommended plan, with a home loan and no jargon", () => {
    const model = show("H01");
    expect(model?.selectedId).toBe("S0003");
    expect(model?.estimated).toBe(false);
    expect(model?.today).toMatchObject({ debtFree: "Nov 2046", interest: "$230,358", monthly: "$3,620" });
    expect(model?.plan.finishes).toBe(true);
    expect(model?.plan.interest).not.toBe(model?.today.interest);
    expect(model?.plan.debtFree).not.toBe(model?.today.debtFree);
    expect(model?.interestSaved.endsWith("less")).toBe(true);
    expect(model?.monthsSooner).toMatch(/months sooner$/);
    expect(model?.loan).toBe("This plan includes a loan. It is secured on your home.");
    expect(model?.plan.payoff.slice(0, 3).map((step) => step.name)).toEqual([
      "Chase Sapphire",
      "Citi Double Cash",
      "SoFi Personal Loan",
    ]);
    expect(model?.plan.payoff.slice(0, 3).every((step) => step.when === "When the plan starts")).toBe(true);
    expect(model?.plan.payoff.map((step) => step.name)).toContain("Rocket Mortgage");
    const spoken = householdText(model!);
    for (const word of FORBIDDEN) expect(spoken.toLowerCase()).not.toContain(word.toLowerCase());
  });

  it("changes every figure when the advisor switches scenario", () => {
    const recommended = show("H01");
    const nightly = show("H01", "S0002");
    const avalanche = show("H01", "avalanche");
    expect(nightly?.plan.interest).not.toBe(recommended?.plan.interest);
    expect(nightly?.plan.debtFree).not.toBe(recommended?.plan.debtFree);
    expect(nightly?.monthsSooner).not.toBe(recommended?.monthsSooner);
    expect(nightly?.interestSaved).not.toBe(recommended?.interestSaved);
    expect(avalanche?.loan).toBeNull();
    expect(avalanche?.plan.interest).not.toBe(recommended?.plan.interest);
    expect(avalanche?.plan.monthly).not.toBe("");
  });

  it("says a FastApp loan is not secured on the home", () => {
    const model = show("H11");
    expect(model?.selectedId).toBe("S0015");
    expect(model?.loan).toBe("This plan includes a loan. It is not secured on your home.");
    expect(model?.estimated).toBe(false);
    const spoken = householdText(model!);
    for (const word of FORBIDDEN) expect(spoken.toLowerCase()).not.toContain(word.toLowerCase());
  });

  it("keeps household notes for a missing credit score and a debt left out", () => {
    expect(show("H03")?.estimated).toBe(true);
    const leftOut = show("H07")?.leftOut ?? [];
    expect(leftOut.length).toBeGreaterThan(0);
    expect(leftOut.every((name) => name.length > 0)).toBe(true);
  });

  it("returns nothing for an unknown household", () => {
    expect(show("H00")).toBeNull();
  });
});
