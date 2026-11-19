import { loanProducts } from "../data";
import type { Debt, Household, MonthsOrNever, PaymentAlert } from "../types";
import { amortise } from "./amortise";
import { asWorking, householdFico, todayPayment, validDebts, type WorkingHousehold } from "./household";
import { pythonRound } from "./round";
import { simulate, type ScheduleRow, type SimDebt } from "./simulate";

const FASTAPP_LIMIT: Record<number, number> = { 1: 50_000, 2: 150_000, 3: 300_000 };
const MINIMUM: Record<string, number> = {
  FastApp: 10_000,
  "HELOAN Yellow": 25_000,
  "HELOAN Pink": 20_000,
};

type Band = { min: number; residence: number; investment: number };

const YELLOW: Band[] = [
  { min: 740, residence: 0.85, investment: 0.75 },
  { min: 720, residence: 0.8, investment: 0.7 },
  { min: 680, residence: 0.75, investment: 0.65 },
  { min: 660, residence: 0.7, investment: 0.6 },
  { min: 640, residence: 0.6, investment: 0.5 },
];

const PINK: Band[] = [
  { min: 740, residence: 0.9, investment: 0.75 },
  { min: 720, residence: 0.9, investment: 0.75 },
  { min: 680, residence: 0.85, investment: 0.7 },
];

const PRODUCT_RULE: Record<string, { excluded: ReadonlySet<string>; bands: Band[] } | "unsecured"> = {
  FastApp: "unsecured",
  "HELOAN Yellow": { excluded: new Set(["TX"]), bands: YELLOW },
  "HELOAN Pink": { excluded: new Set(["TX", "VT", "IA"]), bands: PINK },
};

const NOT_UNSECURED = new Set(["Mortgage", "Home equity loan", "Reverse mortgage"]);

export type BuiltOffer = {
  household_id: string;
  product: string;
  property_id: string | null;
  security: "secured" | "unsecured";
  term_months: number;
  rate: number;
  max_available: number;
  loan_amount: number;
  debts_paid_off: string;
  loan_payment: number;
  contractual_monthly: number;
  payment_change_pct: number;
  payment_alert: PaymentAlert;
  months_to_debt_free: MonthsOrNever;
  total_interest: number;
  /** Unrounded contractual payment. Offer ranking uses this, not the rounded figure. */
  contractualRaw: number;
  /** Null when the simulation never finishes. Zero stays zero. */
  months: number | null;
  /** Plan month each remaining debt reached zero. Moved debts are not listed. */
  payoffMonths: Record<string, number>;
  /** Present only when the caller asked for a schedule. */
  schedule?: ScheduleRow[];
};

type Candidate = {
  product: string;
  propertyId: string | null;
  security: "secured" | "unsecured";
  limit: number;
  rate: number;
  term: number;
  mandatory: Debt[];
};

function blended(parts: readonly { balance: number; rate: number }[]): number {
  const total = parts.reduce((sum, part) => sum + part.balance, 0);
  if (!total) return 0;
  return parts.reduce((sum, part) => sum + part.balance * part.rate, 0) / total;
}

function alertFor(rise: number): PaymentAlert {
  if (rise <= 0.1) return "none";
  if (rise <= 0.25) return "amber";
  return "red";
}

function bandFor(bands: readonly Band[], fico: number): Band | undefined {
  return bands.find((band) => fico >= band.min);
}

function propertyCandidates(
  state: WorkingHousehold,
  product: string,
  term: number,
  rate: number,
  bands: readonly Band[],
  fico: number,
): Candidate[] {
  const band = bandFor(bands, fico);
  if (!band) return [];
  const candidates: Candidate[] = [];
  for (const property of state.properties) {
    const onProperty = state.debts.filter((debt) => debt.property_id === property.property_id);
    if (onProperty.some((debt) => debt.debt_type === "Reverse mortgage")) continue;
    const mortgages = onProperty.filter((debt) => debt.debt_type === "Mortgage");
    if (mortgages.length === 0) continue;
    const cltv = property.property_type === "Residence" ? band.residence : band.investment;
    const available = property.value * cltv - mortgages.reduce((sum, debt) => sum + debt.balance, 0);
    const cap =
      product === "HELOAN Yellow"
        ? property.property_type === "Investment" || fico < 680
          ? 350_000
          : 500_000
        : 750_000;
    candidates.push({
      product,
      propertyId: property.property_id,
      security: "secured",
      limit: Math.min(available, cap),
      rate,
      term,
      mandatory: onProperty.filter((debt) => debt.debt_type === "Home equity loan"),
    });
  }
  return candidates;
}

function toSim(debt: Debt): SimDebt {
  return {
    id: debt.debt_id,
    balance: debt.balance,
    rate: debt.rate,
    payment: debt.monthly_payment,
  };
}

/** One offer per catalogue row and, for home equity, per eligible property. */
export function buildOffers(
  household: string | Household | WorkingHousehold,
  options?: { schedule?: boolean },
): BuiltOffer[] {
  const state = asWorking(household);
  const valid = validDebts(state.debts);
  const payTotal = todayPayment(state.debts);
  const { fico } = householdFico(state.members);
  const comfortZone = state.household.comfort_zone;
  const base = valid.map(toSim);
  const unsecured = valid
    .filter((debt) => !debt.property_id && !NOT_UNSECURED.has(debt.debt_type))
    .slice()
    .sort((a, b) => b.rate - a.rate);

  const candidates: Candidate[] = [];
  for (const product of loanProducts) {
    const rule = PRODUCT_RULE[product.product];
    if (!rule) continue;
    const term = product.term_months;
    const rate = product.rate;
    if (rule === "unsecured") {
      const limit = comfortZone == null ? undefined : FASTAPP_LIMIT[comfortZone];
      if (state.fastAppApproved && limit != null && product.comfort_zone === comfortZone) {
        candidates.push({
          product: product.product,
          propertyId: null,
          security: "unsecured",
          limit,
          rate,
          term,
          mandatory: [],
        });
      }
      continue;
    }
    if (rule.excluded.has(state.household.home_state)) continue;
    candidates.push(
      ...propertyCandidates(state, product.product, term, rate, rule.bands, fico),
    );
  }

  const offers: BuiltOffer[] = [];
  for (const candidate of candidates) {
    if (candidate.limit <= 0) continue;
    const chosen: Debt[] = [];
    let amount = 0;
    for (const debt of candidate.mandatory) {
      chosen.push(debt);
      amount += debt.balance;
    }
    if (amount > candidate.limit) continue;
    for (const debt of unsecured) {
      if (debt.rate > candidate.rate && amount + debt.balance <= candidate.limit) {
        chosen.push(debt);
        amount += debt.balance;
      }
    }
    const minimum = MINIMUM[candidate.product] ?? 0;
    if (amount < minimum || chosen.length === 0) continue;

    const moved = new Set(chosen.map((debt) => debt.debt_id));
    const remaining = base.filter((debt) => !moved.has(debt.id));
    const oldBlend = blended(base);
    const newBlend = blended([...remaining, { balance: amount, rate: candidate.rate }]);
    if (newBlend >= oldBlend) continue;

    const loanPayment = amortise(amount, candidate.rate, candidate.term);
    const rest: SimDebt[] = [
      ...remaining,
      { id: "NEW_LOAN", balance: amount, rate: candidate.rate, payment: loanPayment },
    ];
    const contractual = rest.reduce((sum, debt) => sum + debt.payment, 0);
    const simulated = simulate(rest, "avalanche", Math.max(payTotal, contractual), [], {
      schedule: options?.schedule === true,
    });
    const rise = payTotal ? contractual / payTotal - 1 : 0;
    offers.push({
      household_id: state.household.household_id,
      product: candidate.product,
      property_id: candidate.propertyId,
      security: candidate.security,
      term_months: candidate.term,
      rate: candidate.rate,
      max_available: pythonRound(candidate.limit),
      loan_amount: pythonRound(amount),
      debts_paid_off: chosen.map((debt) => debt.debt_id).join(";"),
      loan_payment: pythonRound(loanPayment),
      contractual_monthly: pythonRound(contractual),
      payment_change_pct: pythonRound(rise * 100, 1),
      payment_alert: alertFor(rise),
      months_to_debt_free: simulated.months ? simulated.months : "never",
      total_interest: simulated.totalInterest,
      contractualRaw: contractual,
      months: simulated.months,
      payoffMonths: simulated.payoffMonths,
      ...(options?.schedule ? { schedule: simulated.schedule } : {}),
    });
  }
  return offers;
}

export type FastAppMiss =
  | { kind: "no_comfort_zone" }
  | { kind: "below_minimum"; amount: number; minimum: number; cardsOnly: boolean }
  | { kind: "blended_rate" }
  | { kind: "no_higher_rate_debt" };

/**
 * Why a pre-approved household has no FastApp offer.
 * Null when FastApp is not relevant, or when an offer exists.
 */
export function fastAppMiss(household: string | Household | WorkingHousehold): FastAppMiss | null {
  const state = asWorking(household);
  if (!state.fastAppApproved) return null;
  if (buildOffers(state).some((offer) => offer.product === "FastApp")) return null;
  const comfortZone = state.household.comfort_zone;
  if (comfortZone == null) return { kind: "no_comfort_zone" };

  const rates = loanProducts
    .filter((product) => product.product === "FastApp" && product.comfort_zone === comfortZone)
    .map((product) => product.rate);
  const limit = FASTAPP_LIMIT[comfortZone] ?? 0;
  const valid = validDebts(state.debts);
  const unsecured = valid
    .filter((debt) => !debt.property_id && !NOT_UNSECURED.has(debt.debt_type))
    .slice()
    .sort((a, b) => b.rate - a.rate);
  const base = valid.map(toSim);
  const minimum = MINIMUM.FastApp ?? 0;
  let bestAmount = 0;
  let bestDebts: Debt[] = [];
  let blockedByBlend = false;

  for (const rate of rates) {
    const chosen: Debt[] = [];
    let amount = 0;
    for (const debt of unsecured) {
      if (debt.rate > rate && amount + debt.balance <= limit) {
        chosen.push(debt);
        amount += debt.balance;
      }
    }
    if (amount > bestAmount) {
      bestAmount = amount;
      bestDebts = chosen;
    }
    if (amount < minimum || chosen.length === 0) continue;
    const moved = new Set(chosen.map((debt) => debt.debt_id));
    const remaining = base.filter((debt) => !moved.has(debt.id));
    const oldBlend = blended(base);
    const newBlend = blended([...remaining, { balance: amount, rate }]);
    if (newBlend >= oldBlend) blockedByBlend = true;
  }

  if (bestAmount >= minimum && blockedByBlend) return { kind: "blended_rate" };
  if (bestAmount > 0 && bestAmount < minimum) {
    return {
      kind: "below_minimum",
      amount: bestAmount,
      minimum,
      cardsOnly: bestDebts.length > 0 && bestDebts.every((debt) => debt.debt_type === "Credit card"),
    };
  }
  return { kind: "no_higher_rate_debt" };
}
