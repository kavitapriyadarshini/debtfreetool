import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOffers } from "../engine/offers";
import { householdWithCase } from "../engine/scenario";
import { runPipeline } from "../engine/pipeline";
import { firmView } from "../firm";
import { FLAG_LABEL, listOpportunities, sortOpportunities } from "../opportunity";
import { PAGE_SIZE } from "../config";
import { selectVisibleHouseholds } from "../selectors";
import * as source from "../data";
import { workspaceFor } from "../workspace";

const SOURCE_FILES = [
  "households.json",
  "household_members.json",
  "debts.json",
  "properties.json",
  "fastapp_list.json",
  "loan_products.json",
  "cases.json",
  "case_history.json",
  "case_overrides.json",
  "scenarios.json",
  "scenario_results.json",
  "extra_payments.json",
  "custom_loans.json",
  "contact_history.json",
  "pipeline_results.json",
  "pipeline_offers.json",
  "pipeline_flags.json",
];

function sourceFiles(): Record<string, string> {
  return Object.fromEntries(
    SOURCE_FILES.map((name) => [name, readFileSync(resolve("src/data", name), "utf8")]),
  );
}

function sourceMemory(): string {
  return JSON.stringify({
    households: source.households,
    members: source.members,
    debts: source.debts,
    properties: source.properties,
    fastAppApprovals: source.fastAppApprovals,
    loanProducts: source.loanProducts,
    pipelineResults: source.pipelineResults,
    pipelineOffers: source.pipelineOffers,
    pipelineFlags: source.pipelineFlags,
    cases: source.cases,
    caseHistory: source.caseHistory,
    scenarios: source.scenarios,
    scenarioResults: source.scenarioResults,
    extraPayments: source.extraPayments,
    caseOverrides: source.caseOverrides,
    customLoans: source.customLoans,
    contacts: source.contacts,
    outreach: source.outreach,
    qaExpectedDataIssues: source.qaExpectedDataIssues,
  });
}

describe("acceptance guards", () => {
  it("never writes an edit back to the source JSON", async () => {
    const filesBefore = sourceFiles();
    const memoryBefore = sourceMemory();
    const saved = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => saved.get(key) ?? null,
        setItem: (key: string, value: string) => {
          saved.set(key, value);
        },
        removeItem: (key: string) => {
          saved.delete(key);
        },
        clear: () => saved.clear(),
        key: (index: number) => [...saved.keys()][index] ?? null,
        get length() {
          return saved.size;
        },
      },
    });

    const { useDemoStore } = await import("../store");
    const store = useDemoStore.getState();
    store.resetDemo();
    store.setUser({ role: "advisor", name: "Pamela Wilson", branch: "North Branch" });
    const caseId = store.startCase("H01");
    store.addOverride({
      caseId,
      householdId: "H01",
      entityType: "debt",
      entityId: "H01-D02",
      field: "monthly_payment",
      sourceValue: 350,
      overrideValue: 400,
      reason: "Acceptance check",
    });
    store.addExtraPayment({
      caseId,
      householdId: "H01",
      type: "one_off",
      amount: 500,
      startMonth: "2027-04",
      reason: "Bonus",
    });
    store.addCustomLoan({
      caseId,
      householdId: "H01",
      lenderName: "Acceptance lender",
      rate: 8,
      termMonths: 60,
      maxAmount: 10000,
    });
    const scenarioId = store.addScenario({
      caseId,
      householdId: "H01",
      name: "Acceptance custom",
      strategy: "avalanche",
      loanSource: "none",
    });
    store.recommend(scenarioId, "Checking the audit");
    store.recordDecision(caseId, "agreed", { channel: "servicing_call" });

    const empty = { overrides: [] as const, extraPayments: [] as const, customLoans: [] as const };
    workspaceFor("H01", "C0001", { overrides: source.caseOverrides, extraPayments: source.extraPayments, customLoans: source.customLoans }, source.scenarios);
    workspaceFor("H11", null, empty, []);
    runPipeline();
    firmView({
      households: source.households,
      contacts: source.contacts,
      cases: source.cases,
      scenarios: source.scenarios,
      caseState: { overrides: source.caseOverrides, extraPayments: source.extraPayments, customLoans: source.customLoans },
      branch: "all",
      advisor: "all",
    });

    expect(sourceMemory()).toBe(memoryBefore);
    expect(sourceFiles()).toEqual(filesBefore);
    store.resetDemo();
  });

  it("lists a plan that raises the payment, including H11's red FastApp", () => {
    const empty = { overrides: [], extraPayments: [], customLoans: [] };
    const state = householdWithCase("H11", empty);
    const offers = buildOffers(state);
    const view = workspaceFor("H11", null, empty, []);
    expect(offers.some((offer) => offer.payment_alert === "red")).toBe(true);
    expect(view?.cards.length).toBe(3 + offers.length);
    for (const offer of offers) {
      const card = view?.cards.find((row) => row.id === `offer:${offer.product}:${offer.term_months}:${offer.property_id ?? "none"}`);
      expect(card?.alert).toBe(offer.payment_alert);
    }
    const red = view?.cards.find((card) => card.name === "FastApp 1-year");
    expect(red?.alert).toBe("red");
  });

  it("keeps an advisor's ready page to 25 households, ranked by months saved", () => {
    const pamela = selectVisibleHouseholds({ role: "advisor", name: "Pamela Wilson", branch: "North Branch" });
    expect(pamela.every((household) => household.advisor === "Pamela Wilson")).toBe(true);
    expect(pamela.some((household) => household.advisor !== "Pamela Wilson")).toBe(false);
    const ready = sortOpportunities(
      listOpportunities(pamela, source.contacts, source.cases, source.caseOverrides).filter((row) => row.outreach === "ready"),
      "months",
    );
    expect(ready.slice(0, PAGE_SIZE)).toHaveLength(PAGE_SIZE);
    const months = ready.map((row) => (row.noAction ? Number.NEGATIVE_INFINITY : row.monthsSaved === "from never" ? Number.POSITIVE_INFINITY : row.monthsSaved));
    const page = months.slice(0, PAGE_SIZE);
    expect([...page].sort((a, b) => b - a)).toEqual(page);
    const firstNoAction = ready.findIndex((row) => row.noAction);
    if (firstNoAction >= 0) {
      expect(ready.slice(firstNoAction).every((row) => row.noAction)).toBe(true);
    }
  });

  it("does not use the word referral on the firm view or the opportunity flags", () => {
    const model = firmView({
      households: source.households,
      contacts: source.contacts,
      cases: source.cases,
      scenarios: source.scenarios,
      caseState: { overrides: source.caseOverrides, extraPayments: source.extraPayments, customLoans: source.customLoans },
      branch: "all",
      advisor: "all",
    });
    const spoken = JSON.stringify({ model, flags: FLAG_LABEL }).toLowerCase();
    expect(spoken).not.toContain("referral");
  });
});
