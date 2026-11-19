import { describe, expect, it } from "vitest";
import { caseOverrides, cases, customLoans, extraPayments, scenarios } from "../data";
import { householdWithCase } from "../engine/scenario";
import { NOT_COMPARABLE } from "../format";
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
    expect(view?.cards.some((row) => row.alert === "red" && row.alertLabel === "Monthly payment $1,562 → $4,548 (+191%)")).toBe(true);
  });

  it("says when the current path never pays off", () => {
    const view = workspaceFor("H07", null, empty, []);
    const current = view?.cards.find((card) => card.id === "current");
    expect(current?.note).toBe(NEVER_NOTE);
    expect(current?.debtFree).toBe(NEVER_NOTE);
    expect(current?.monthsSaved).toBe(NOT_COMPARABLE);
    expect(current?.interestSaved).toBe(NOT_COMPARABLE);
    expect(view?.debtRows.find((row) => row.debtId === "H07-D01")).toMatchObject({
      name: "AAG Reverse Mortgage",
      included: false,
    });
    expect(current?.interest).toBe(NOT_COMPARABLE);
    const saved = view?.cards.map((card) => card.monthsSaved) ?? [];
    expect(saved.every((value) => value === NOT_COMPARABLE)).toBe(true);
    expect(saved.join(" ")).not.toMatch(/from never|n\/a|—/i);
    expect(view?.comparableNote).toBe(
      "Today's payments never clear these debts. With the best plan: debt free in 8 years 10 months.",
    );
  });

  it("pins H01's current path first and gives Nightly best to Yellow 15-year only", () => {
    const view = model("H01");
    expect(view?.cards[0]?.name).toBe("Current path");
    expect(view?.cards[0]?.origin).toBe("today");
    expect(view?.cards[0]?.badges).toContain("Today");
    const nightly = view?.cards.filter((card) => card.nightly) ?? [];
    expect(nightly).toHaveLength(1);
    expect(nightly[0]?.name).toBe("HELOAN Yellow 15-year");
    expect(nightly[0]?.badges).toContain("Nightly best");
    expect(nightly[0]?.loan).toBe("HELOAN Yellow · 15-year · $35,000 · Secured on the home");
    expect(nightly[0]?.interestSaved).toBe("$102,847");
    expect(nightly[0]?.monthsSaved).toBe("111 months");
    expect(Object.values(nightly[0]?.debtWhen ?? {})).toContain("Paid by new loan");
    expect(view?.cards[0]?.loan).toBe("None");
    expect(view?.cards[0]?.interestSaved).toBe("—");
    const dated = Object.values(view?.cards[0]?.debtWhen ?? {}).find((value) => value !== "Never");
    expect(dated).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
    const builtIn = view?.cards.filter((card) => card.origin === "builtin" && !card.nightly) ?? [];
    expect(builtIn.some((card) => card.name === "HELOAN Yellow 15-year")).toBe(false);
    expect(builtIn.map((card) => card.name)).toEqual(
      expect.arrayContaining(["Avalanche", "Snowball"]),
    );
    expect(view?.cards.filter((card) => card.origin === "advisor").every((card) => card.badges.includes("Built by you"))).toBe(true);
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
