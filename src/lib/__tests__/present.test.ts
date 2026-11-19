import { describe, expect, it } from "vitest";
import { caseOverrides, cases, customLoans, extraPayments, scenarios } from "../data";
import { presentFor } from "../present";

const state = { overrides: caseOverrides, extraPayments, customLoans };

function show(id: string, plan = "", compared: string[] = []) {
  const caseRecord = [...cases].reverse().find((row) => row.household_id === id);
  return presentFor(id, caseRecord?.case_id ?? null, state, scenarios, plan, compared);
}

const FORBIDDEN = ["avalanche", "snowball", "HELOAN", "FICO", "APR", "no_fico", "possible_duplicate", "payment alert"];

const ADVANTAGE = [
  /^Debt free .+ sooner\.$/,
  /^\$[\d,]+ less interest\.$/,
  /^Monthly payment \$[\d,]+ lower\.$/,
  /^\d+ debts become \d+\.$/,
];

const THINGS = [
  /^The plan only works if you keep paying today's total each month as debts clear\.$/,
  /^Monthly payment \$[\d,]+ higher\.$/,
  /^The new loan is secured on your home, which is at risk if payments are missed\.$/,
  /^A new loan needs a credit application\.$/,
  /^The loan runs \d+ years?\.$/,
  /^Figures are estimated because there's no credit score on file\.$/,
  /^.+ is not included in this plan\.$/,
];

function householdText(model: NonNullable<ReturnType<typeof show>>): string {
  return [
    model.title,
    model.advisor,
    model.date,
    model.today.debtFree,
    model.today.interest,
    model.today.monthly,
    model.plan.debtFree,
    model.plan.interest,
    model.plan.monthly,
    model.interestSaved,
    model.monthsSooner,
    ...model.advantages,
    ...model.thingsToKnow,
    ...model.dataEdits,
    ...model.columns.flatMap((column) => [
      column.heading,
      column.debtFree,
      column.sooner,
      column.interest,
      column.interestSaved,
      column.monthly,
      ...column.payoff.flatMap((step) => [step.debt, step.rate, step.when]),
    ]),
    ...model.plan.years.flatMap((year) => [
      String(year.year),
      year.startBalance,
      year.endBalance,
      ...year.cleared,
      ...year.months.flatMap((month) => [month.label, ...month.debts.flatMap((debt) => [debt.name, debt.payment, debt.interest, debt.balance])]),
    ]),
  ].join(" ");
}

function assertPlain(text: string) {
  for (const word of FORBIDDEN) {
    if (word === "APR") {
      expect(text).not.toMatch(/\bAPR\b/);
      continue;
    }
    expect(text.toLowerCase()).not.toContain(word.toLowerCase());
  }
}

function onlyRuleNine(model: NonNullable<ReturnType<typeof show>>) {
  for (const line of model.advantages) expect(ADVANTAGE.some((pattern) => pattern.test(line))).toBe(true);
  for (const line of model.thingsToKnow) expect(THINGS.some((pattern) => pattern.test(line))).toBe(true);
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
    expect(model?.interestSaved).toBe("$107,710");
    expect(model?.dataEdits).toEqual([]);
    expect(model?.monthsSooner).toMatch(/months sooner$/);
    expect(model?.loan).toBe("This plan includes a loan. It is secured on your home.");
    expect(model?.title).toBe("Your recommended plan: Pay off your cards with a home equity loan, then clear the rest in order");
    expect(model?.advisor).toBe("Pamela Wilson");
    expect(model?.date).toBe("14 Nov 2026");
    expect(model?.columns.map((column) => column.heading).slice(0, 2)).toEqual(["Today", "Your recommended plan"]);
    expect(model?.advantages).toEqual([
      "Debt free 9 years 6 months sooner.",
      "$107,710 less interest.",
      "5 debts become 3.",
    ]);
    expect(model?.thingsToKnow).toEqual([
      "The plan only works if you keep paying today's total each month as debts clear.",
      "The new loan is secured on your home, which is at risk if payments are missed.",
      "A new loan needs a credit application.",
      "The loan runs 15 years.",
    ]);
    onlyRuleNine(model!);
    expect(model?.plan.years[0]?.year).toBe(2026);
    expect(model?.plan.years[0]?.months[0]?.label).toBe("Dec 2026");
    expect(model?.plan.years[0]?.cleared).toEqual(expect.arrayContaining(["Chase Sapphire", "Citi Double Cash", "SoFi Personal Loan"]));
    expect(model?.plan.payoff.slice(0, 3)).toEqual([
      { debt: "Chase Sapphire", rate: "24.99%", when: "Upon starting new plan (Dec 2026)" },
      { debt: "Citi Double Cash", rate: "21.5%", when: "Upon starting new plan (Dec 2026)" },
      { debt: "SoFi Personal Loan", rate: "13%", when: "Upon starting new plan (Dec 2026)" },
    ]);
    expect(model?.plan.payoff).toContainEqual(expect.objectContaining({ debt: "Home equity loan", rate: "7.875%" }));
    expect(model?.plan.payoff).toContainEqual(expect.objectContaining({ debt: "Rocket Mortgage", rate: "6.25%" }));
    expect(model?.plan.payoff.some((step) => step.when === "When the plan starts" || step.debt.includes("(was"))).toBe(false);
    expect(model?.columns[1]?.sooner).toBe("9 years 6 months");
    expect(model?.columns[1]?.interestSaved).toBe("$107,710");
    assertPlain(householdText(model!));
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
    expect(model?.title).toBe("Your recommended plan: Pay off some debts with a new loan, then clear the rest in order");
    expect(model?.thingsToKnow).toContain("A new loan needs a credit application.");
    expect(model?.thingsToKnow).toContain("The loan runs 3 years.");
    expect(model?.thingsToKnow).not.toContain("The new loan is secured on your home, which is at risk if payments are missed.");
    onlyRuleNine(model!);
    expect(model?.estimated).toBe(false);
    assertPlain(householdText(model!));
  });

  it("keeps household notes for a missing credit score and a debt left out", () => {
    const missing = show("H03");
    expect(missing?.estimated).toBe(false);
    expect(missing?.thingsToKnow.some((line) => line.includes("estimated"))).toBe(false);
    onlyRuleNine(missing!);
    const left = show("H07");
    const leftOut = left?.leftOut ?? [];
    expect(leftOut.length).toBeGreaterThan(0);
    expect(leftOut.every((name) => name.length > 0)).toBe(true);
    for (const name of leftOut) expect(left?.thingsToKnow).toContain(`${name} is not included in this plan.`);
    onlyRuleNine(left!);
    assertPlain(householdText(missing!));
    assertPlain(householdText(left!));
  });

  it("puts the other compared plans in grey columns, in plain words", () => {
    const model = show("H01", "", ["avalanche", "snowball", "S0002"]);
    const grey = model?.columns.filter((column) => column.tone === "other") ?? [];
    expect(grey.map((column) => column.id)).toEqual(["avalanche", "snowball", "S0002"]);
    expect(grey[0]?.heading).toBe("Keep today's payment and clear the highest rate first");
    expect(grey[0]?.source).toContain("Built-in");
    expect(grey[1]?.heading).toBe("Keep today's payment and clear the smallest balance first");
    expect(grey[2]?.heading).toBe("Pay off your cards with a home equity loan, then clear the rest in order");
    const twins = show("H01", "avalanche", ["S0002", "S0003"])?.columns.filter((column) => column.tone === "other") ?? [];
    expect(twins.map((column) => column.heading)).toEqual([
      "Pay off your cards with a home equity loan, then clear the rest in order",
      "Pay off your cards with a home equity loan, then clear the rest in order",
    ]);
    expect(new Set(twins.map((column) => `${column.heading}|${column.source}`)).size).toBe(twins.length);
    const repeated = show("H55", "S0042", ["avalanche", "S0041"])?.columns.filter((column) => column.tone === "other") ?? [];
    expect(repeated).toHaveLength(1);
    expect(repeated[0]?.heading).toBe("Keep today's payment and clear the highest rate first");
    assertPlain(householdText(model!));
  });

  it("estimates figures only for a home equity loan when no credit score is on file", () => {
    const fast = show("H275", "offer:FastApp:24:none");
    expect(fast?.estimated).toBe(false);
    expect(fast?.thingsToKnow.some((line) => line.toLowerCase().includes("estimated"))).toBe(false);
    expect(fast?.dataEdits).toEqual([]);
    expect(fast?.plan.payoff[0]?.when).toBe("Upon starting new plan (Dec 2026)");
    expect(fast?.plan.payoff.some((step) => step.when === "When the plan starts" || /\(was /.test(step.debt))).toBe(false);
    expect(fast?.plan.payoff[0]).toMatchObject({ debt: expect.any(String), rate: expect.stringMatching(/%$/) });
    const home = show("H275", "offer:HELOAN Yellow:180:P275A");
    expect(home?.estimated).toBe(true);
    expect(home?.thingsToKnow).toContain("Figures are estimated because there's no credit score on file.");
    onlyRuleNine(home!);
    const plain = show("H275", "avalanche");
    expect(plain?.estimated).toBe(false);
    expect(plain?.thingsToKnow.some((line) => line.toLowerCase().includes("estimated"))).toBe(false);
    assertPlain(householdText(fast!));
    assertPlain(householdText(home!));
  });

  it("lists each case edit once, and never inside the payoff order", () => {
    const model = show("H55");
    expect(model?.dataEdits).toEqual([
      "Amex Gold, monthly payment: $827 (was $307) · Household confirmed their actual monthly payment · Pamela Wilson, 21 Oct 2026",
    ]);
    const payoff = model?.columns.flatMap((column) => column.payoff.flatMap((step) => [step.debt, step.rate, step.when])).join(" ") ?? "";
    expect(payoff).not.toContain("(was");
    expect(payoff).not.toContain("Pamela Wilson");
    const scored = show("H11");
    expect(scored?.dataEdits).toEqual([
      "Capital One Venture, left out of the plan: Left out (was Included) · Household confirmed it is the same card listed twice · Tom Brennan, 15 Oct 2026",
      "Andre Moore, credit score: 698 (was No score) · Household shared a recent credit report · Tom Brennan, 15 Oct 2026",
    ]);
    expect(scored?.thingsToKnow.some((line) => line.toLowerCase().includes("estimated"))).toBe(false);
  });

  it("returns nothing for an unknown household", () => {
    expect(show("H00")).toBeNull();
  });
});
