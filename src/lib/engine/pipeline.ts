import { households } from "../data";
import type { MonthsOrNever, PipelineFlag, PipelineOffer, PipelineResult } from "../types";
import {
  bestOffer,
  bestPlan,
  builtInPlans,
  monthsSaved,
  paymentAlert,
  planFromOffer,
  status,
} from "./bestPlan";
import { flags, householdFico, loadHousehold } from "./household";
import { buildOffers, type BuiltOffer } from "./offers";
import { pythonRound } from "./round";

function monthsLabel(months: number | null): MonthsOrNever {
  return months ? months : "never";
}

function toOffer(offer: BuiltOffer): PipelineOffer {
  return {
    household_id: offer.household_id,
    product: offer.product,
    property_id: offer.property_id,
    security: offer.security,
    term_months: offer.term_months,
    rate: offer.rate,
    max_available: offer.max_available,
    loan_amount: offer.loan_amount,
    debts_paid_off: offer.debts_paid_off,
    loan_payment: offer.loan_payment,
    contractual_monthly: offer.contractual_monthly,
    payment_change_pct: offer.payment_change_pct,
    payment_alert: offer.payment_alert,
    months_to_debt_free: offer.months_to_debt_free,
    total_interest: offer.total_interest,
  };
}

function rankMonths(saved: PipelineResult["months_saved"]): number {
  if (typeof saved === "number") return saved;
  return saved === "from never" ? 10_000 : -1;
}

function rankInterest(saved: PipelineResult["interest_saved"]): number {
  return typeof saved === "number" ? saved : 0;
}

let pipelineCache: {
  results: PipelineResult[];
  offers: PipelineOffer[];
  flags: PipelineFlag[];
} | null = null;

/** Nightly results, offers and flags for every household, in source order. Memoised: the source book does not change at runtime. */
export function runPipeline(): {
  results: PipelineResult[];
  offers: PipelineOffer[];
  flags: PipelineFlag[];
} {
  if (pipelineCache) return pipelineCache;
  const results: PipelineResult[] = [];
  const offers: PipelineOffer[] = [];
  const flagRows: PipelineFlag[] = [];

  for (const source of households) {
    const state = loadHousehold(source.household_id);
    const plans = builtInPlans(state, { schedule: false });
    const householdOffers = buildOffers(state);
    offers.push(...householdOffers.map(toOffer));

    const chosenOffer = bestOffer(householdOffers);
    const candidates = [plans.current, plans.avalanche, plans.snowball];
    if (chosenOffer) candidates.push(planFromOffer(chosenOffer));
    const best = bestPlan(candidates);
    const saved = monthsSaved(plans.current.months, best.months);
    const flagHits = flags(state.household, state.members, state.debts, state.properties);
    const flagNames = [...new Set(flagHits.map((hit) => hit.flag))].sort();
    const planPayment = Math.max(best.contractual, plans.payTotal);
    const fastAppMiss =
      state.fastAppApproved && !householdOffers.some((offer) => offer.product === "FastApp");
    const fico = householdFico(state.members);
    const valid = state.debts.filter((debt) => debt.monthly_payment > 0);

    results.push({
      household_id: source.household_id,
      advisor: source.advisor,
      branch: source.branch,
      fico_used: fico.fico,
      fico_defaulted: fico.defaulted,
      valid_debts: valid.length,
      excluded_debts: state.debts.length - valid.length,
      total_balance: pythonRound(valid.reduce((sum, debt) => sum + debt.balance, 0)),
      current_monthly: pythonRound(plans.payTotal),
      current_months: monthsLabel(plans.current.months),
      current_interest: plans.current.interest,
      avalanche_months: monthsLabel(plans.avalanche.months),
      avalanche_interest: plans.avalanche.interest,
      snowball_months: monthsLabel(plans.snowball.months),
      snowball_interest: plans.snowball.interest,
      offers: householdOffers.length,
      best_offer: chosenOffer ? `${chosenOffer.product} ${chosenOffer.term_months}m` : null,
      best_plan: best.name,
      best_plan_months: monthsLabel(best.months),
      best_plan_interest: best.interest,
      best_plan_monthly: pythonRound(planPayment),
      best_plan_payment_change_pct: plans.payTotal
        ? pythonRound((planPayment / plans.payTotal - 1) * 100, 1)
        : 0,
      best_plan_payment_alert: paymentAlert(planPayment, plans.payTotal),
      months_saved: saved,
      interest_saved:
        plans.current.months == null ? "n/a" : plans.current.interest - best.interest,
      status: status(best.name, saved),
      fastapp_preapproved_no_offer: fastAppMiss,
      flags: flagNames.length > 0 ? flagNames.join(";") : null,
      advisor_rank: 0,
    });

    for (const hit of flagHits) {
      flagRows.push({
        household_id: source.household_id,
        entity_id: hit.entityId || null,
        flag: hit.flag,
      });
    }
  }

  const byAdvisor = new Map<string, PipelineResult[]>();
  for (const result of results) {
    const rows = byAdvisor.get(result.advisor);
    if (rows) rows.push(result);
    else byAdvisor.set(result.advisor, [result]);
  }
  for (const rows of byAdvisor.values()) {
    rows.sort((a, b) => {
      const byMonths = rankMonths(b.months_saved) - rankMonths(a.months_saved);
      if (byMonths !== 0) return byMonths;
      return rankInterest(b.interest_saved) - rankInterest(a.interest_saved);
    });
    rows.forEach((row, index) => {
      row.advisor_rank = index + 1;
    });
  }

  pipelineCache = { results, offers, flags: flagRows };
  return pipelineCache;
}
