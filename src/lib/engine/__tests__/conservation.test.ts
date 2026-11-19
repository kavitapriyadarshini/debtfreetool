import { describe, expect, it } from "vitest";
import { caseOverrides, cases, customLoans, extraPayments, households, scenarios } from "../../data";
import { builtInPlans } from "../bestPlan";
import { buildOffers } from "../offers";
import { householdWithCase, runScenario } from "../scenario";
import type { ScheduleRow } from "../simulate";

const PAID_OFF = 0.005;

/**
 * Opening balances plus interest equal every payment in the schedule, within $1.
 * A plan that finishes closes the last month at zero. A plan that never finishes does not.
 */
function booksBalance(label: string, months: number | null, interest: number, schedule: readonly ScheduleRow[]) {
  if (schedule.length === 0) {
    expect(months ?? 0, label).toBe(0);
    return;
  }
  const openingRow = schedule[0];
  if (!openingRow) throw new Error(`${label} schedule has no opening month`);
  const opening = openingRow.debts.reduce((sum, debt) => sum + debt.openingBalance, 0);
  let paid = 0;
  for (const row of schedule) {
    for (const debt of row.debts) paid += debt.payment;
  }
  const last = schedule[schedule.length - 1];
  if (!last) throw new Error(`${label} schedule has no closing month`);
  const remaining = last.debts.reduce((sum, debt) => sum + debt.closingBalance, 0);
  expect(Math.abs(opening + interest - paid - remaining), label).toBeLessThanOrEqual(1);
  if (months == null) {
    expect(
      last.debts.some((debt) => debt.closingBalance > PAID_OFF),
      label,
    ).toBe(true);
    return;
  }
  expect(Math.abs(opening + interest - paid), label).toBeLessThanOrEqual(1);
  for (const debt of last.debts) {
    expect(debt.closingBalance, `${label} ${debt.id}`).toBeLessThanOrEqual(PAID_OFF);
  }
}

describe("schedule books", () => {
  it("balances every household and every plan", () => {
    for (const household of households) {
      const id = household.household_id;
      const plans = builtInPlans(id);
      for (const plan of [plans.current, plans.avalanche, plans.snowball]) {
        booksBalance(`${id} ${plan.name}`, plan.months, plan.interest, plan.schedule);
      }
      for (const offer of buildOffers(id, { schedule: true })) {
        booksBalance(
          `${id} ${offer.product} ${offer.term_months}`,
          offer.months,
          offer.total_interest,
          offer.schedule ?? [],
        );
      }
    }
    for (const caseRecord of cases) {
      const facts = caseOverrides.filter((row) => row.case_id === caseRecord.case_id);
      if (facts.length === 0) continue;
      const edited = householdWithCase(caseRecord.household_id, {
        overrides: facts,
        extraPayments: [],
        customLoans: [],
      });
      const planned = builtInPlans(edited);
      for (const plan of [planned.current, planned.avalanche, planned.snowball]) {
        booksBalance(`${caseRecord.household_id} case ${plan.name}`, plan.months, plan.interest, plan.schedule);
      }
      for (const offer of buildOffers(edited, { schedule: true })) {
        booksBalance(
          `${caseRecord.household_id} case ${offer.product} ${offer.term_months}`,
          offer.months,
          offer.total_interest,
          offer.schedule ?? [],
        );
      }
    }
    for (const scenario of scenarios) {
      const result = runScenario(
        scenario.household_id,
        {
          overrides: caseOverrides.filter((row) => row.case_id === scenario.case_id),
          extraPayments: extraPayments.filter((row) => row.case_id === scenario.case_id),
          customLoans: customLoans.filter((row) => row.case_id === scenario.case_id),
        },
        scenario,
      );
      booksBalance(
        `${scenario.household_id} ${scenario.name}`,
        result.months,
        result.totalInterest,
        result.schedule,
      );
    }
  }, 120_000);
});
