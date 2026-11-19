import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OnePager } from "@/components/one-pager";
import { AS_OF } from "../config";
import { caseOverrides, cases, customLoans, extraPayments, pipelineResults, scenarios } from "../data";
import { runScenario } from "../engine/scenario";
import {
  A4_MM,
  LETTER_MM,
  ONE_PAGER_CSS,
  PAGE_MARGIN_MM,
  SHEET_HEIGHT_MM,
  SHEET_WIDTH_MM,
  compactSchedule,
  onePagerContent,
} from "../one-pager";
import { buildSnapshot } from "../snapshot";
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

function spanOf(value: number | "never" | null | undefined): number {
  if (value === "never") return 600;
  return value ?? 0;
}

function longestHousehold(): string {
  let best = pipelineResults[0];
  let months = -1;
  for (const row of pipelineResults) {
    const span = Math.max(
      spanOf(row.current_months),
      spanOf(row.avalanche_months),
      spanOf(row.snowball_months),
      spanOf(row.best_plan_months),
    );
    if (span > months) {
      months = span;
      best = row;
    }
  }
  return best?.household_id ?? "H113";
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

  const longestId = longestHousehold();
  const longest = freeze(longestId, currentScenario(longestId));

  it("keeps the sheet inside both A4 and US Letter", () => {
    expect(SHEET_WIDTH_MM).toBeLessThanOrEqual(A4_MM.width - PAGE_MARGIN_MM * 2);
    expect(SHEET_WIDTH_MM).toBeLessThanOrEqual(LETTER_MM.width - PAGE_MARGIN_MM * 2);
    expect(SHEET_HEIGHT_MM).toBeLessThanOrEqual(A4_MM.height - PAGE_MARGIN_MM * 2);
    expect(SHEET_HEIGHT_MM).toBeLessThanOrEqual(LETTER_MM.height - PAGE_MARGIN_MM * 2);
    expect(ONE_PAGER_CSS).toContain("A4");
    expect(ONE_PAGER_CSS).toContain("letter");
    expect(ONE_PAGER_CSS).toContain("12mm");
    expect(ONE_PAGER_CSS).not.toContain("page-break-after: always");
  });

  it("renders H275, H01 and the longest plan on one page without dropping rows", () => {
    expect(h275 && h01 && longest).toBeTruthy();
    expect(longest!.years.flatMap((year) => year.months).length).toBeGreaterThan(h01!.years.flatMap((year) => year.months).length);
    for (const snapshot of [h275!, h01!, longest!]) {
      const page = onePagerContent(snapshot);
      const months = snapshot.years.flatMap((year) => year.months);
      expect(page.schedule.reduce((sum, row) => sum + row.covered, 0)).toBe(months.length);
      expect(page.scheduleHeightMm).toBeLessThanOrEqual(SHEET_HEIGHT_MM);
      expect(page.leftHeightMm).toBeLessThanOrEqual(SHEET_HEIGHT_MM);
      expect(page.schedulePoint === 8 || page.schedulePoint === 7).toBe(true);

      const html = renderToStaticMarkup(createElement(OnePager, { snapshot }));
      expect(html).toContain('data-testid="one-pager"');
      expect(html).toContain('data-testid="pdf-summary"');
      expect(html).toContain('data-testid="pdf-schedule"');
      expect(html).toContain("Your schedule");
      expect(html).toContain("Monthly for the first 2 years, then yearly.");
      expect(html).toContain("Your recommended plan:");
      if (page.advantages.length > 0) expect(html).toContain("good about this plan");
      if (page.things.length > 0) expect(html).toContain("Things to know");
      expect(html).toContain(snapshot.note);
      expect(html).toContain(`data-schedule-rows="${page.schedule.length}"`);
      const printed = [...html.matchAll(/data-schedule-line="([^"]*)"/g)].map((match) => match[1]);
      expect(printed).toEqual(page.schedule.map((row) => row.when));
      expect(html).not.toContain("When the plan starts");
    }
  });

  it("prints H275's FastApp plan without calling the figures estimated", () => {
    const page = onePagerContent(h275!);
    expect(page.title.startsWith("Your recommended plan:")).toBe(true);
    expect(page.plan.some((line) => line.includes("not secured"))).toBe(true);
    expect(page.things.some((line) => line.toLowerCase().includes("estimated"))).toBe(false);
    expect(page.edits).toEqual([]);
    expect(page.schedule.filter((row) => row.kind === "month")).toHaveLength(24);
    expect(page.schedule.some((row) => row.kind === "year")).toBe(true);
    const html = renderToStaticMarkup(createElement(OnePager, { snapshot: h275! }));
    expect(html).not.toContain("Data edits, if any");
    expect(html).not.toContain("Figures are estimated");
  });

  it("keeps every month of a short plan and folds the rest of a long plan into years", () => {
    const h01Lines = compactSchedule(h01!.years);
    expect(h01Lines.filter((row) => row.kind === "month")).toHaveLength(24);
    expect(h01Lines.at(-1)?.kind).toBe("year");
    const longLines = compactSchedule(longest!.years);
    expect(longLines[0]?.kind).toBe("month");
    expect(longLines[23]?.kind).toBe("month");
    expect(longLines[24]?.kind).toBe("year");
    expect(longLines.reduce((sum, row) => sum + row.covered, 0)).toBe(longest!.years.flatMap((year) => year.months).length);
  });
});
