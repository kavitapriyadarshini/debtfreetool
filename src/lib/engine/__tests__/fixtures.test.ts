import { describe, expect, it } from "vitest";
import { AS_OF } from "../../config";
import {
  caseOverrides,
  contacts,
  customLoans,
  extraPayments,
  outreach,
  pipelineFlags,
  pipelineOffers,
  pipelineResults,
  scenarioResults,
  scenarios,
} from "../../data";
import type { ContactEvent, PipelineFlag, PipelineOffer, PipelineResult } from "../../types";
import { bestOffer, builtInPlans, planFromOffer, suggestion } from "../bestPlan";
import { buildOffers } from "../offers";
import { outreachStatus } from "../outreach";
import { runPipeline } from "../pipeline";
import { runScenario } from "../scenario";

function interestClose(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1;
}

function sameCount(actual: number, expected: number): boolean {
  return actual === expected || Math.abs(actual - expected) < 1e-9;
}

describe("H01 worked example", () => {
  const plans = builtInPlans("H01");
  const offers = buildOffers("H01");

  it("matches the current path, avalanche and snowball", () => {
    expect(plans.current.months).toBe(240);
    expect(plans.current.interest).toBe(230358);
    expect(plans.current.schedule).toHaveLength(240);
    expect(plans.current.schedule[0]?.debts.find((debt) => debt.id === "H01-D01")?.openingBalance).toBe(
      280000,
    );

    expect(plans.avalanche.months).toBe(134);
    expect(plans.avalanche.interest).toBe(145717);
    expect(plans.snowball.months).toBe(134);
    expect(plans.snowball.interest).toBe(145800);
  });

  it("prices HELOAN Yellow at $35,000 and the equity available on the home", () => {
    const yellow10 = offers.find((offer) => offer.product === "HELOAN Yellow" && offer.term_months === 120);
    const yellow15 = offers.find((offer) => offer.product === "HELOAN Yellow" && offer.term_months === 180);
    expect(yellow10).toMatchObject({ loan_amount: 35000, months_to_debt_free: 129, total_interest: 127511 });
    expect(yellow15).toMatchObject({ loan_amount: 35000, months_to_debt_free: 129, total_interest: 127511 });
    expect(offers.filter((offer) => offer.product === "HELOAN Yellow").every((offer) => offer.max_available === 80000)).toBe(
      true,
    );
    expect(offers.filter((offer) => offer.product === "HELOAN Pink").every((offer) => offer.max_available === 125000)).toBe(
      true,
    );
  });

  it("suggests HELOAN Yellow 180 months", () => {
    const offer = bestOffer(offers);
    expect(offer?.product).toBe("HELOAN Yellow");
    expect(offer?.term_months).toBe(180);
    if (!offer) throw new Error("H01 best offer is missing");
    const suggested = suggestion([
      plans.current,
      plans.avalanche,
      plans.snowball,
      planFromOffer(offer),
    ]);
    expect(suggested.plan.name).toBe("HELOAN Yellow 180m");
    expect(suggested.why).toBe(
      "5 months sooner and $18,200 less interest than paying smarter without a loan. Secured on your home.",
    );
  });
});

describe("H11 nightly best", () => {
  it("is FastApp 12 months at $4,548 with a red payment alert", () => {
    const result = runPipeline().results.find((row) => row.household_id === "H11");
    expect(result?.best_plan).toBe("FastApp 12m");
    expect(result?.best_plan_months).toBe(12);
    expect(result?.best_plan_monthly).toBe(4548);
    expect(result?.best_plan_payment_alert).toBe("red");
  });
});

describe("pipeline fixtures", () => {
  const pipeline = runPipeline();

  it("matches every pipeline result", () => {
    const actual = new Map(pipeline.results.map((row) => [row.household_id, row]));
    const mismatches: string[] = [];
    expect(actual.size).toBe(pipelineResults.length);
    for (const expected of pipelineResults) {
      const row = actual.get(expected.household_id);
      if (!row) {
        mismatches.push(`${expected.household_id} missing`);
        continue;
      }
      mismatches.push(...diffResult(expected, row));
    }
    expect(mismatches, mismatches.slice(0, 20).join("\n")).toEqual([]);
  });

  it("matches every pipeline offer", () => {
    const mismatches = diffKeyed(
      pipelineOffers,
      pipeline.offers,
      (offer) =>
        [offer.household_id, offer.product, offer.property_id ?? "", offer.term_months, offer.rate].join("|"),
      (expected, actual) => diffOffer(expected, actual),
    );
    expect(mismatches, mismatches.slice(0, 20).join("\n")).toEqual([]);
  });

  it("matches every pipeline flag", () => {
    const key = (flag: PipelineFlag) => `${flag.household_id}|${flag.entity_id ?? ""}|${flag.flag}`;
    const expectedKeys = pipelineFlags.map(key).sort();
    const actualKeys = pipeline.flags.map(key).sort();
    expect(actualKeys).toEqual(expectedKeys);
  });
});

describe("scenario fixtures", () => {
  it("reproduces every advisor scenario", () => {
    const expectedById = new Map(scenarioResults.map((row) => [row.scenario_id, row]));
    const mismatches: string[] = [];
    for (const scenario of scenarios) {
      const expected = expectedById.get(scenario.scenario_id);
      if (!expected) {
        mismatches.push(`${scenario.scenario_id} missing from fixtures`);
        continue;
      }
      const actual = runScenario(
        scenario.household_id,
        { overrides: caseOverrides, extraPayments, customLoans },
        scenario,
      );
      const months = actual.months ? actual.months : "never";
      if (months !== expected.months_to_debt_free) {
        mismatches.push(`${scenario.scenario_id} months ${months} != ${expected.months_to_debt_free}`);
      }
      if (!interestClose(actual.totalInterest, expected.total_interest)) {
        mismatches.push(`${scenario.scenario_id} interest ${actual.totalInterest} != ${expected.total_interest}`);
      }
      if (actual.monthly !== expected.monthly_payment) {
        mismatches.push(`${scenario.scenario_id} monthly ${actual.monthly} != ${expected.monthly_payment}`);
      }
      if (actual.requiredMonthly !== expected.required_monthly) {
        mismatches.push(
          `${scenario.scenario_id} required ${actual.requiredMonthly} != ${expected.required_monthly}`,
        );
      }
      if (actual.paymentAlert !== expected.payment_alert) {
        mismatches.push(`${scenario.scenario_id} alert ${actual.paymentAlert} != ${expected.payment_alert}`);
      }
      if (!sameCount(actual.paymentChangePct, expected.payment_change_pct)) {
        mismatches.push(
          `${scenario.scenario_id} change ${actual.paymentChangePct} != ${expected.payment_change_pct}`,
        );
      }
    }
    expect(mismatches, mismatches.slice(0, 20).join("\n")).toEqual([]);
  });
});

describe("outreach fixtures", () => {
  it("reproduces every household outreach row at AS_OF", () => {
    const byHousehold = new Map<string, ContactEvent[]>();
    for (const contact of contacts) {
      const rows = byHousehold.get(contact.household_id);
      if (rows) rows.push(contact);
      else byHousehold.set(contact.household_id, [contact]);
    }
    const mismatches: string[] = [];
    for (const expected of outreach) {
      const actual = outreachStatus(byHousehold.get(expected.household_id) ?? [], AS_OF);
      const fields: [string, unknown, unknown][] = [
        ["last_contacted_at", actual.last_contacted_at, expected.last_contacted_at],
        ["days_since_last_contact", actual.days_since_last_contact, expected.days_since_last_contact],
        ["last_contact_channel", actual.last_contact_channel, expected.last_contact_channel],
        ["last_offer_at", actual.last_offer_at, expected.last_offer_at],
        ["last_offer_outcome", actual.last_offer_outcome, expected.last_offer_outcome],
        ["last_offer_included_loan", actual.last_offer_included_loan, expected.last_offer_included_loan],
        ["cooling_off_rule", actual.cooling_off_rule, expected.cooling_off_rule],
        ["eligible_for_outreach_from", actual.eligible_for_outreach_from, expected.eligible_for_outreach_from],
        ["days_until_eligible", actual.days_until_eligible, expected.days_until_eligible],
        ["outreach_status", actual.outreach_status, expected.outreach_status],
      ];
      for (const [field, got, want] of fields) {
        if (got !== want) mismatches.push(`${expected.household_id} ${field} ${String(got)} != ${String(want)}`);
      }
    }
    expect(mismatches, mismatches.slice(0, 20).join("\n")).toEqual([]);
  });
});

function diffResult(expected: PipelineResult, actual: PipelineResult): string[] {
  const mismatches: string[] = [];
  const exact: (keyof PipelineResult)[] = [
    "fico_used",
    "fico_defaulted",
    "valid_debts",
    "excluded_debts",
    "total_balance",
    "current_monthly",
    "current_months",
    "avalanche_months",
    "snowball_months",
    "offers",
    "best_offer",
    "best_plan",
    "best_plan_months",
    "best_plan_monthly",
    "best_plan_payment_alert",
    "months_saved",
    "status",
    "fastapp_preapproved_no_offer",
    "flags",
    "advisor_rank",
  ];
  for (const field of exact) {
    if (actual[field] !== expected[field]) {
      mismatches.push(`${expected.household_id} ${field} ${String(actual[field])} != ${String(expected[field])}`);
    }
  }
  if (!sameCount(actual.best_plan_payment_change_pct, expected.best_plan_payment_change_pct)) {
    mismatches.push(
      `${expected.household_id} best_plan_payment_change_pct ${actual.best_plan_payment_change_pct} != ${expected.best_plan_payment_change_pct}`,
    );
  }
  for (const field of ["current_interest", "avalanche_interest", "snowball_interest", "best_plan_interest"] as const) {
    if (!interestClose(actual[field], expected[field])) {
      mismatches.push(`${expected.household_id} ${field} ${actual[field]} != ${expected[field]}`);
    }
  }
  if (typeof expected.interest_saved === "number") {
    if (typeof actual.interest_saved !== "number" || !interestClose(actual.interest_saved, expected.interest_saved)) {
      mismatches.push(
        `${expected.household_id} interest_saved ${String(actual.interest_saved)} != ${expected.interest_saved}`,
      );
    }
  } else if (actual.interest_saved !== expected.interest_saved) {
    mismatches.push(
      `${expected.household_id} interest_saved ${String(actual.interest_saved)} != ${expected.interest_saved}`,
    );
  }
  return mismatches;
}

function diffOffer(expected: PipelineOffer, actual: PipelineOffer): string[] {
  const mismatches: string[] = [];
  const id = `${expected.household_id} ${expected.product} ${expected.term_months}m`;
  const exact: (keyof PipelineOffer)[] = [
    "property_id",
    "security",
    "rate",
    "max_available",
    "loan_amount",
    "debts_paid_off",
    "loan_payment",
    "contractual_monthly",
    "payment_alert",
    "months_to_debt_free",
  ];
  for (const field of exact) {
    if (actual[field] !== expected[field]) {
      mismatches.push(`${id} ${field} ${String(actual[field])} != ${String(expected[field])}`);
    }
  }
  if (!sameCount(actual.payment_change_pct, expected.payment_change_pct)) {
    mismatches.push(`${id} payment_change_pct ${actual.payment_change_pct} != ${expected.payment_change_pct}`);
  }
  if (!interestClose(actual.total_interest, expected.total_interest)) {
    mismatches.push(`${id} total_interest ${actual.total_interest} != ${expected.total_interest}`);
  }
  return mismatches;
}

function diffKeyed<T>(
  expected: readonly T[],
  actual: readonly T[],
  key: (row: T) => string,
  diff: (expected: T, actual: T) => string[],
): string[] {
  const actualByKey = new Map(actual.map((row) => [key(row), row]));
  const mismatches: string[] = [];
  if (actual.length !== expected.length) {
    mismatches.push(`row count ${actual.length} != ${expected.length}`);
  }
  const seen = new Set<string>();
  for (const row of expected) {
    const id = key(row);
    seen.add(id);
    const match = actualByKey.get(id);
    if (!match) mismatches.push(`missing ${id}`);
    else mismatches.push(...diff(row, match));
  }
  for (const row of actual) {
    const id = key(row);
    if (!seen.has(id)) mismatches.push(`unexpected ${id}`);
  }
  return mismatches;
}
