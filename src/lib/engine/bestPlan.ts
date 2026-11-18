import { ALERT_AMBER, ALERT_RED, TIE_WINDOW_MONTHS } from "../config";
import type { Household, PaymentAlert } from "../types";
import { asWorking, todayPayment, validDebts, type WorkingHousehold } from "./household";
import type { BuiltOffer } from "./offers";
import { simulate, type ScheduleRow, type SimDebt, type Strategy } from "./simulate";

const NEVER = 1_000_000;
const RISK = { none: 0, unsecured: 1, secured: 2 } as const;

export type PlanRisk = keyof typeof RISK;

export type PlanOption = {
  name: string;
  months: number | null;
  interest: number;
  contractual: number;
  risk: PlanRisk;
  schedule: ScheduleRow[];
  payoffOrder: string[];
};

export type Suggestion = {
  plan: PlanOption;
  why: string;
};

function monthsValue(months: number | null): number {
  return months == null ? NEVER : months;
}

function toSim(debt: { debt_id: string; balance: number; rate: number; monthly_payment: number }): SimDebt {
  return { id: debt.debt_id, balance: debt.balance, rate: debt.rate, payment: debt.monthly_payment };
}

function planFromSimulation(
  name: string,
  result: ReturnType<typeof simulate>,
  contractual: number,
  risk: PlanRisk,
): PlanOption {
  return {
    name,
    months: result.months,
    interest: result.totalInterest,
    contractual,
    risk,
    schedule: result.schedule,
    payoffOrder: result.payoffOrder,
  };
}

/** Current path, avalanche and snowball at today's payment. */
export function builtInPlans(
  household: string | Household | WorkingHousehold,
  options?: { schedule?: boolean },
): { payTotal: number; current: PlanOption; avalanche: PlanOption; snowball: PlanOption } {
  const state = asWorking(household);
  const valid = validDebts(state.debts);
  const payTotal = todayPayment(state.debts);
  const debts = valid.map(toSim);
  const run = (strategy: Strategy) =>
    simulate(debts, strategy, payTotal, [], { schedule: options?.schedule });
  return {
    payTotal,
    current: planFromSimulation("Current path", run("current"), payTotal, "none"),
    avalanche: planFromSimulation("Avalanche", run("avalanche"), payTotal, "none"),
    snowball: planFromSimulation("Snowball", run("snowball"), payTotal, "none"),
  };
}

/** Lowest months, then interest, then unrounded contractual, then risk. Nothing is dropped for payment. */
export function bestOffer<T extends BuiltOffer>(offers: readonly T[]): T | null {
  let best: T | null = null;
  let bestKey: [number, number, number, number] | null = null;
  for (const offer of offers) {
    const key: [number, number, number, number] = [
      offer.months ? offer.months : NEVER,
      offer.total_interest,
      offer.contractualRaw,
      RISK[offer.security],
    ];
    if (!bestKey || compareTuple(key, bestKey) < 0) {
      best = offer;
      bestKey = key;
    }
  }
  return best;
}

export function planFromOffer(offer: BuiltOffer): PlanOption {
  const keyMonths = offer.months ? offer.months : NEVER;
  return {
    name: `${offer.product} ${offer.term_months}m`,
    months: keyMonths < NEVER ? keyMonths : null,
    interest: offer.total_interest,
    contractual: offer.contractual_monthly,
    risk: offer.security,
    schedule: [],
    payoffOrder: [],
  };
}

function compareTuple(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

/** Fastest months. Within one month: less interest, then lower contractual payment, then less risk. */
export function bestPlan(plans: readonly PlanOption[]): PlanOption {
  if (plans.length === 0) throw new Error("bestPlan needs at least one plan");
  const fastest = Math.min(...plans.map((plan) => monthsValue(plan.months)));
  const tied = plans.filter((plan) => monthsValue(plan.months) - fastest <= TIE_WINDOW_MONTHS);
  let best = tied[0]!;
  for (const plan of tied.slice(1)) {
    const key = [plan.interest, plan.contractual, RISK[plan.risk]];
    const bestKey = [best.interest, best.contractual, RISK[best.risk]];
    if (compareTuple(key, bestKey) < 0) best = plan;
  }
  return best;
}

export function monthsSaved(
  currentMonths: number | null,
  bestMonths: number | null,
): number | "from never" {
  if (currentMonths == null) return bestMonths != null ? "from never" : 0;
  return currentMonths - monthsValue(bestMonths);
}

export function status(
  bestName: string,
  saved: number | "from never",
): "opportunity" | "no_action_needed" {
  if (bestName === "Current path" || saved === 0) return "no_action_needed";
  return "opportunity";
}

/** `rise = monthly / today - 1`. At or under 10% is none, at or under 25% is amber. */
export function paymentAlert(monthly: number, today: number): PaymentAlert {
  if (!today) return "none";
  const rise = monthly / today - 1;
  if (rise <= ALERT_AMBER) return "none";
  if (rise <= ALERT_RED) return "amber";
  return "red";
}

function formatDollars(amount: number): string {
  return `$${Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function tieBreak(winner: PlanOption, other: PlanOption): string {
  if (winner.interest < other.interest) return "Tied on time; less interest";
  if (winner.contractual < other.contractual) return "Tied on time; lower monthly payment";
  if (RISK[winner.risk] < RISK[other.risk]) return "Tied on time; less risk";
  return "Tied on time, interest, and payment.";
}

function sooner(winner: PlanOption, baseline: PlanOption, than: string): string {
  if (baseline.months == null && winner.months != null) {
    const unit = winner.months === 1 ? "month" : "months";
    const sentence = `Debt free in ${winner.months} ${unit} instead of never.`;
    return winner.risk === "secured" ? `${sentence} Secured on your home.` : sentence;
  }
  const months = monthsValue(baseline.months) - monthsValue(winner.months);
  const interest = baseline.interest - winner.interest;
  const unit = months === 1 ? "month" : "months";
  const dollars = Math.round(Math.abs(interest) / 100) * 100;
  const interestText =
    dollars === 0
      ? ""
      : interest > 0
        ? ` and ${formatDollars(dollars)} less interest`
        : ` and ${formatDollars(dollars)} more interest`;
  let sentence = `${months} ${unit} sooner${interestText} than ${than}.`;
  if (winner.risk === "secured") sentence += " Secured on your home.";
  return sentence;
}

/**
 * The same ranking as the nightly best plan, plus why it won.
 * A loan is explained against the better of avalanche and snowball.
 */
export function suggestion(plans: readonly PlanOption[]): Suggestion {
  const plan = bestPlan(plans);
  const others = plans.filter((candidate) => candidate !== plan);
  const fastest = monthsValue(plan.months);
  const tied = others.filter((candidate) => monthsValue(candidate.months) - fastest <= TIE_WINDOW_MONTHS);
  if (plan.name === "Current path" && tied.length === 0) return { plan, why: "No action needed" };
  if (tied.length > 0) return { plan, why: tieBreak(plan, bestPlan(tied)) };

  if (plan.risk !== "none") {
    const smarter = plans.filter((candidate) => candidate.name === "Avalanche" || candidate.name === "Snowball");
    if (smarter.length > 0) {
      return { plan, why: sooner(plan, bestPlan(smarter), "paying smarter without a loan") };
    }
  }
  const current = plans.find((candidate) => candidate.name === "Current path");
  if (current && current !== plan) return { plan, why: sooner(plan, current, "the current path") };
  return { plan, why: "No action needed" };
}
