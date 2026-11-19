import { describe, expect, it } from "vitest";
import { caseOverrides, cases, customLoans, extraPayments, households, scenarios } from "../data";
import { householdWithCase } from "../engine/scenario";
import { formatMoney, NOT_COMPARABLE } from "../format";
import {
  BELOW_MINIMUM,
  INCLUDES_EXTRAS,
  LOAN_MOVES_NOTHING,
  NAME_TAKEN,
  NEVER_NOTE,
  WONT_SAVE,
  describePayment,
  extrasPhrase,
  interestSavedText,
  paymentRule,
  previewDraft,
  previewHousehold,
  reservedPlanNames,
  savingsText,
  scenarioNameError,
  whyWithExtras,
  workspaceFor,
  type ScenarioDraft,
} from "../workspace";
import { compareFor } from "../compare";
import type { Scenario } from "../types";

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
  it("states that every plan keeps today's payment and rolls it to the next debt", () => {
    const view = model("H01");
    const today = view?.cards.find((card) => card.origin === "today");
    expect(formatMoney(today?.todayMonthly ?? 0)).toBe("$3,620");
    expect(paymentRule("$3,620")).toBe(
      "Every plan pays at least today's $3,620 a month; when a debt is paid off, its payment moves to the next debt (highest rate first for avalanche, smallest balance first for snowball).",
    );
  });

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
    expect(yellow?.moneyGoes[0]).toBe(
      "New loan of $35,000 pays off Chase, Citi and SoFi; their $1,050 a month stops; the loan's $332 starts; the other $718 goes to the new loan, the highest rate left.",
    );
    expect(yellow?.loanDebt).toBe("New loan · HELOAN Yellow · 7.875%");
    expect(yellow?.debtWhen.NEW_LOAN).toBe("Jan 2030");
    expect(view?.debtRows.find((row) => row.name === "Chase Sapphire")?.rate).toBe("24.99%");
  });

  it("pays off its last debt in the month the plan becomes debt free", () => {
    for (const household of households) {
      const view = model(household.household_id);
      expect(view, household.household_id).not.toBeNull();
      for (const card of view?.cards ?? []) {
        if (card.spanMonths == null) continue;
        const latest = Math.max(...Object.values(card.payoffMonths));
        expect(latest, `${household.household_id} ${card.name}`).toBe(card.spanMonths);
        if (card.loanDebt) expect(card.payoffMonths.NEW_LOAN, card.name).toEqual(expect.any(Number));
      }
    }
  });

  it("says where H55 avalanche sends a paid-off payment", () => {
    const view = model("H55");
    const avalanche = view?.cards.find((card) => card.name === "Avalanche (edited data)");
    expect(avalanche?.moneyGoes).toContain(
      "Feb 2028: Capital One paid off; its $1,322 a month moves to Synchrony, now $1,891.",
    );
    expect(view?.debtRows.find((row) => row.debtId === "H55-D01")).toMatchObject({
      name: "Amex Gold",
      rate: "28.07%",
    });
    expect(avalanche?.loanDebt).toBeNull();
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
    const card = view?.cards.find((row) => row.name === "FastApp 3-yr + extras (edited data)");
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
    expect(view?.cards.some((row) => row.alert === "red" && row.alertLabel === "Monthly payment $1,182 → $3,440 (+191%)")).toBe(true);
  });

  it("keeps the sign when a plan costs more or takes longer", () => {
    expect(savingsText(100, 106)).toBe("6 months later");
    expect(interestSavedText(100, 1_000, 90, 3_177)).toBe("Costs $2,177 more");
    expect(savingsText(100, 100)).toBe("0 months");
    expect(interestSavedText(100, 50, 90, 50)).toBe("$0");
  });

  it("recalculates H55, including the nightly best, on the case inputs", () => {
    const view = workspaceFor("H55", "C0016", {
      overrides: caseOverrides,
      extraPayments,
      customLoans,
    }, scenarios);
    const current = view?.cards.find((card) => card.id === "current");
    const avalanche = view?.cards.filter((card) => card.name === "Avalanche (edited data)");
    const snowball = view?.cards.find((card) => card.name === "Snowball (edited data)");
    expect(current).toMatchObject({
      name: "Current path (edited data)",
      debtFree: "36 months",
      interest: "$21,538",
      monthly: "$3,408; $2,086 from Mar 2028; $1,396 from Apr 2029; $569 from Oct 2029",
      monthsSaved: "0 months",
      interestSaved: "$0",
      spare: "Each debt keeps its own payment, so the amount falls when a debt is paid off.",
    });
    expect(view?.debtRows.find((row) => row.debtId === "H55-D01")).toMatchObject({
      edits: ["$827 (was $307) · Household confirmed their actual monthly payment · Pamela Wilson, 21 Oct 2026"],
      resolved: true,
    });
    expect(avalanche).toHaveLength(1);
    expect(avalanche?.[0]).toMatchObject({
      debtFree: "25 months",
      interest: "$18,234",
      monthly: "$3,408",
      monthsSaved: "11 months",
      interestSaved: "$3,304",
      spare: "Spare money goes to Synchrony Store Card, the highest rate.",
    });
    expect(avalanche?.[0]?.badges).toEqual(expect.arrayContaining(["Nightly best", "Built-in", "Built by you"]));
    expect(snowball).toMatchObject({
      debtFree: "25 months",
      interest: "$18,533",
      monthly: "$3,408",
      spare: "Spare money goes to Synchrony Store Card, the smallest balance.",
    });
    expect(view?.cards.some((card) => card.monthly === "$2,888")).toBe(false);
    expect(view?.cards.filter((card) => card.nightly)).toHaveLength(1);
    const extras = view?.cards.find((card) => card.name === "Avalanche + extras (edited data)");
    expect(extras?.monthly).toBe("$3,408; $3,708 from Sep 2027");
    expect(extras?.badges).toContain(INCLUDES_EXTRAS);
    expect(extras?.alertLabel).toBe("None");
    expect(current?.badges).not.toContain(INCLUDES_EXTRAS);
    expect(avalanche?.[0]?.badges).not.toContain(INCLUDES_EXTRAS);
    expect(view?.suggestionWhy).toContain("including an extra $300 a month from Sep 2027");
  });

  it("names a lump sum when that plan is the one that won", () => {
    expect(extrasPhrase([{ type: "one_off", amount: 13300, startMonth: "2026-12" }])).toBe(
      "a $13,300 lump sum in Dec 2026",
    );
    expect(
      whyWithExtras("6 months sooner than the current path.", [
        { type: "one_off", amount: 13300, startMonth: "2026-12" },
      ]),
    ).toBe("6 months sooner than the current path, including a $13,300 lump sum in Dec 2026.");
    expect(describePayment(3408, [{ type: "recurring", amount: 300, startMonth: "2027-09" }])).toEqual({
      display: "$3,408; $3,708 from Sep 2027",
      peak: 3708,
    });
  });

  it("refuses a loan that moves no debt and a name the case already uses", () => {
    const state = { overrides: caseOverrides, extraPayments, customLoans };
    const view = workspaceFor("H01", "C0001", state, scenarios);
    const taken = reservedPlanNames(view?.choices ?? [], scenarios.filter((row) => row.case_id === "C0001"), null);
    expect(scenarioNameError("snowball", taken)).toBe(NAME_TAKEN);
    expect(scenarioNameError("Avalanche", taken)).toBe(NAME_TAKEN);
    expect(scenarioNameError("HELOAN Yellow 15-year", taken)).toBe(NAME_TAKEN);
    expect(scenarioNameError("A fresh name", taken)).toBeNull();

    const emptyLoan: Scenario = {
      scenario_id: "S-empty",
      case_id: "C0016",
      household_id: "H55",
      name: "Loan with nothing moved",
      strategy: "avalanche",
      loan_source: "custom",
      product: null,
      term_months: 60,
      loan_amount: 10000,
      loan_rate: 8,
      debts_paid_off: null,
      extra_payment_ids: null,
      created_by: "Pamela Wilson",
      is_recommended: false,
      advisor_reason: null,
    };
    const withLoan = workspaceFor("H55", "C0016", state, [...scenarios, emptyLoan]);
    const column = withLoan?.cards.find((card) => card.id === "S-empty");
    expect(column?.note).toBe(LOAN_MOVES_NOTHING);
    expect(column?.comparable).toBe(false);
    expect(column?.labels).toContain(LOAN_MOVES_NOTHING);
    expect(withLoan?.suggestionId).not.toBe("S-empty");
    const compared = compareFor("H55", "C0016", state, [...scenarios, emptyLoan], ["S-empty", "avalanche"]);
    expect(compared?.columns.map((column) => column.id)).toEqual(["current", "avalanche"]);
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
    expect(view?.cards[0]?.interestSaved).toBe("$0");
    expect(view?.cards[0]?.monthsSaved).toBe("0 months");
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
