import { describe, expect, it } from "vitest";
import { caseOverrides, cases, customLoans, extraPayments, scenarios } from "../data";
import { householdWithCase } from "../engine/scenario";
import {
  BELOW_MINIMUM,
  NEVER_NOTE,
  WONT_SAVE,
  previewDraft,
  previewHousehold,
  workspaceFor,
  type ScenarioDraft,
} from "../workspace";

const empty = { overrides: [], extraPayments: [], customLoans: [] };

function model(id: string) {
  const caseRecord = [...cases].reverse().find((row) => row.household_id === id);
  return workspaceFor(id, caseRecord?.case_id ?? null, {
    overrides: caseOverrides,
    extraPayments,
    customLoans,
  }, scenarios);
}

describe("scenario workspace", () => {
  it("shows H01's Yellow 15-year offer as 129 months and $127,511 with no alert", () => {
    const view = model("H01");
    const names = view?.cards.map((card) => card.name);
    expect(names).toEqual(expect.arrayContaining(["Current path", "Avalanche", "Snowball", "HELOAN Yellow 15-year"]));
    const yellow = view?.cards.find((card) => card.name === "HELOAN Yellow 15-year");
    expect(yellow).toMatchObject({
      debtFree: "129 months",
      interest: "$127,511",
      alert: "none",
      alertLabel: "None",
    });
  });

  it("recalculates as soon as a one-off extra is added", () => {
    const view = model("H01");
    const choice = view?.choices.find((row) => row.label === "HELOAN Yellow 15-year");
    if (!view || !choice) throw new Error("Missing Yellow 15-year");
    const edited = householdWithCase("H01", empty);
    const draft: ScenarioDraft = {
      name: choice.label,
      strategy: "avalanche",
      loanSource: "product",
      product: choice.product,
      termMonths: choice.termMonths,
      loanAmount: choice.amount,
      loanRate: choice.rate,
      debtIds: choice.debtIds,
      extras: [],
    };
    const plain = previewDraft(edited, "C0001", empty, draft);
    const withBonus = previewDraft(edited, "C0001", empty, {
      ...draft,
      extras: [{ id: null, type: "one_off", amount: 5000, startMonth: "2027-04" }],
    });
    expect(withBonus.interestAmount).toBeLessThan(plain.interestAmount);
    expect(withBonus.months).not.toBeNull();
  });

  it("keeps H12 to avalanche and snowball and says why each product is missing", () => {
    const view = model("H12");
    const builtIn = view?.cards.filter((card) => card.kind === "builtin").map((card) => card.name);
    expect(builtIn).toEqual(["Current path", "Avalanche", "Snowball"]);
    expect(view?.gaps).toEqual([
      { product: "FastApp", reason: "Not on the FastApp list." },
      { product: "HELOAN Yellow", reason: "No debt has a rate high enough to refinance." },
      { product: "HELOAN Pink", reason: "No debt has a rate high enough to refinance." },
    ]);
  });

  it("allows a loan that is below the minimum or does not lower the blended rate", () => {
    const edited = householdWithCase("H01", empty);
    expect(loanCheck(edited, 1000, 7.875, ["H01-D02"])).toContain(BELOW_MINIMUM);
    const auto = edited.debts.find((debt) => debt.rate === 6.9);
    expect(auto).toBeTruthy();
    expect(loanCheck(edited, auto?.balance ?? 0, 30, [auto?.debt_id ?? ""])).toContain(WONT_SAVE);
  });

  it("previews a saved extra payment once", () => {
    const view = model("H11");
    const card = view?.cards.find((row) => row.name === "FastApp 3-yr + extras");
    const scenario = scenarios.find((row) => row.scenario_id === card?.scenarioId);
    const caseRecord = [...cases].reverse().find((row) => row.household_id === "H11");
    if (!card || !scenario || !caseRecord) throw new Error("Missing H11 extras scenario");
    const extras = (scenario.extra_payment_ids ?? "")
      .split(";")
      .flatMap((id) => {
        const extra = extraPayments.find((row) => row.extra_id === id);
        return extra ? [{ id, type: extra.type, amount: extra.amount, startMonth: extra.start_month }] : [];
      });
    const preview = previewHousehold("H11", caseRecord.case_id, { overrides: caseOverrides, extraPayments, customLoans }, {
      name: scenario.name,
      strategy: scenario.strategy === "snowball" ? "snowball" : "avalanche",
      loanSource: scenario.loan_source,
      product: scenario.product,
      termMonths: scenario.term_months,
      loanAmount: scenario.loan_amount,
      loanRate: scenario.loan_rate,
      debtIds: (scenario.debts_paid_off ?? "").split(";").filter((id) => id !== ""),
      extras,
    });
    expect(preview).toMatchObject({
      debtFree: card.debtFree,
      interest: card.interest,
      monthly: card.monthly,
      alert: card.alert,
    });
  });

  it("says when the current path never pays off", () => {
    const view = workspaceFor("H07", null, empty, []);
    expect(view?.cards.find((card) => card.id === "current")?.note).toBe(NEVER_NOTE);
  });

  it("marks a home-equity offer as estimated when nobody has a FICO score", () => {
    const view = workspaceFor("H19", null, empty, []);
    const offers = view?.cards.filter((card) => card.name.startsWith("HELOAN")) ?? [];
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((card) => card.labels.includes("estimated"))).toBe(true);

    const scored = workspaceFor("H01", null, empty, []);
    const known = scored?.cards.filter((card) => card.name.startsWith("HELOAN")) ?? [];
    expect(known.length).toBeGreaterThan(0);
    expect(known.every((card) => !card.labels.includes("estimated"))).toBe(true);
  });
});

function loanCheck(
  state: ReturnType<typeof householdWithCase>,
  amount: number,
  rate: number,
  debtIds: string[],
) {
  return previewDraft(state, "C0001", empty, {
    name: "Edited",
    strategy: "avalanche",
    loanSource: "product",
    product: "HELOAN Yellow",
    termMonths: 180,
    loanAmount: amount,
    loanRate: rate,
    debtIds,
    extras: [],
  }).labels;
}
