import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OnePager } from "@/components/one-pager";
import { AS_OF } from "../config";
import { caseOverrides, cases, customLoans, debts, extraPayments, scenarios } from "../data";
import { runScenario } from "../engine/scenario";
import {
  A4_MM,
  LETTER_MM,
  ONE_PAGER_CSS,
  PAGE_MARGIN_MM,
  SHEET_HEIGHT_MM,
  SHEET_WIDTH_MM,
  onePagerContent,
} from "../one-pager";
import { buildSnapshot, type FrozenSnapshot } from "../snapshot";
import type { Scenario } from "../types";

const empty = { overrides: [] as typeof caseOverrides, extraPayments: [], customLoans: [] };

function currentScenario(householdId: string): Scenario {
  return {
    scenario_id: "current",
    case_id: "draft",
    household_id: householdId,
    name: "Today",
    strategy: "current",
    loan_source: "none",
    product: null,
    term_months: null,
    loan_amount: 0,
    loan_rate: null,
    debts_paid_off: null,
    extra_payment_ids: null,
    created_by: "",
    is_recommended: false,
    advisor_reason: null,
  };
}

function freeze(householdId: string, scenario: Scenario, caseId = "draft") {
  return buildSnapshot({
    snapshotId: `N-${householdId}`,
    caseId,
    householdId,
    scenario: { ...scenario, case_id: caseId },
    caseState: caseId === "draft" ? empty : { overrides: caseOverrides, extraPayments, customLoans },
    advisor: "Pamela Wilson",
    frozenAt: AS_OF,
  });
}

/** The plan in the demo data with the most payoff rows. */
function longestPayoff(): FrozenSnapshot {
  const counts = new Map<string, number>();
  for (const debt of debts) counts.set(debt.household_id, (counts.get(debt.household_id) ?? 0) + 1);
  const most = Math.max(...counts.values());
  const ids = [...counts.entries()].filter(([, count]) => count >= most - 1).map(([id]) => id);
  let best: FrozenSnapshot | null = null;
  for (const id of ids) {
    const options = [currentScenario(id), ...scenarios.filter((row) => row.household_id === id)];
    for (const scenario of options) {
      const caseId = scenario.case_id && scenario.scenario_id !== "current" ? scenario.case_id : "draft";
      const snapshot = freeze(id, scenario, caseId);
      if (snapshot && (!best || snapshot.payoff.length > best.payoff.length)) best = snapshot;
    }
  }
  if (!best) throw new Error("No payoff order in the demo data");
  return best;
}

describe("household one-pager", () => {
  const h01Case = cases.find((row) => row.household_id === "H01");
  const h01Scenario = scenarios.find((row) => row.scenario_id === h01Case?.recommended_scenario_id);
  const h01 = h01Case && h01Scenario ? freeze("H01", h01Scenario, h01Case.case_id) : null;

  const fastOffer = runScenario("H275", empty, currentScenario("H275")).offers.find(
    (offer) => offer.product === "FastApp" && offer.term_months === 24,
  );
  const h275 = fastOffer
    ? freeze("H275", {
        scenario_id: "fastapp-24",
        case_id: "draft",
        household_id: "H275",
        name: "FastApp 2-year",
        strategy: "avalanche",
        loan_source: "product",
        product: fastOffer.product,
        term_months: fastOffer.term_months,
        loan_amount: fastOffer.loan_amount,
        loan_rate: fastOffer.rate,
        debts_paid_off: fastOffer.debts_paid_off || null,
        extra_payment_ids: null,
        created_by: "",
        is_recommended: false,
        advisor_reason: null,
      })
    : null;

  const longest = longestPayoff();

  it("keeps the sheet inside both A4 and US Letter", () => {
    expect(SHEET_WIDTH_MM).toBeLessThanOrEqual(A4_MM.width - PAGE_MARGIN_MM * 2);
    expect(SHEET_WIDTH_MM).toBeLessThanOrEqual(LETTER_MM.width - PAGE_MARGIN_MM * 2);
    expect(SHEET_HEIGHT_MM).toBeLessThanOrEqual(A4_MM.height - PAGE_MARGIN_MM * 2);
    expect(SHEET_HEIGHT_MM).toBeLessThanOrEqual(LETTER_MM.height - PAGE_MARGIN_MM * 2);
    expect(ONE_PAGER_CSS).toContain("A4");
    expect(ONE_PAGER_CSS).toContain("letter");
    expect(ONE_PAGER_CSS).toContain("12mm");
    expect(ONE_PAGER_CSS).toContain("flex-direction: column");
    expect(ONE_PAGER_CSS).not.toContain("grid-template-columns");
    expect(ONE_PAGER_CSS).not.toContain("page-break-after: always");
  });

  it("renders H275, H01 and the longest payoff order on one page with no schedule", () => {
    if (!h275) throw new Error("H275 FastApp snapshot is missing");
    if (!h01) throw new Error("H01 snapshot is missing");
    expect(longest.payoff.length).toBeGreaterThan(h01.payoff.length);
    for (const snapshot of [h275, h01, longest]) {
      const page = onePagerContent(snapshot);
      expect(page.payoff).toHaveLength(snapshot.payoff.length);
      expect(page.heightMm).toBeLessThanOrEqual(SHEET_HEIGHT_MM);
      expect(page.point === 8 || page.point === 7).toBe(true);

      const html = renderToStaticMarkup(createElement(OnePager, { snapshot }));
      expect(html).toContain('data-testid="one-pager"');
      expect(html).toContain('data-testid="pdf-summary"');
      expect(html).not.toContain('data-testid="pdf-schedule"');
      expect(html).not.toContain("Your schedule");
      expect(html).not.toContain("Monthly for the first 2 years");
      expect(html).toContain("Your recommended plan:");
      expect(html).toContain(">Today<");
      expect(html).toContain("Payoff order");
      expect(html).toContain(">Debt<");
      expect(html).toContain("Interest rate");
      expect(html).toContain("Paid off");
      if (page.advantages.length > 0) expect(html).toContain("good about this plan");
      if (page.things.length > 0) expect(html).toContain("Things to know");
      expect(html).toContain(snapshot.note);
      expect(html).toContain(`data-payoff-rows="${page.payoff.length}"`);
      for (const row of page.payoff) {
        expect(html).toContain(row.debt);
        expect(html).toContain(row.when);
      }
      expect(html).not.toContain("When the plan starts");
    }
  });

  it("prints H275's FastApp plan without calling the figures estimated", () => {
    if (!h275) throw new Error("H275 FastApp snapshot is missing");
    const page = onePagerContent(h275);
    expect(page.title.startsWith("Your recommended plan:")).toBe(true);
    expect(page.plan.some((line) => line.includes("not secured"))).toBe(true);
    expect(page.things.some((line) => line.toLowerCase().includes("estimated"))).toBe(false);
    expect(page.edits).toEqual([]);
    const html = renderToStaticMarkup(createElement(OnePager, { snapshot: h275 }));
    expect(html).not.toContain("Data edits, if any");
    expect(html).not.toContain("Figures are estimated");
    expect(html).not.toContain("Your schedule");
  });
});
