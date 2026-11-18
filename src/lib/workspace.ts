import { loanProducts, pipelineResults } from "./data";
import { householdFico, todayPayment, validDebts, type WorkingHousehold } from "./engine/household";
import { buildOffers, fastAppMiss, type BuiltOffer } from "./engine/offers";
import { bestOffer, builtInPlans, suggestion, type PlanOption, type PlanRisk } from "./engine/bestPlan";
import { householdWithCase, runScenario, type CaseState } from "./engine/scenario";
import { formatMoney, formatPercent, NOT_COMPARABLE } from "./format";
import { describeFastAppMiss } from "./opportunity";
import type { ExtraPayment, PaymentAlert, Property, Scenario } from "./types";

const MINIMUM: Record<string, number> = {
  FastApp: 10_000,
  "HELOAN Yellow": 25_000,
  "HELOAN Pink": 20_000,
};

const YELLOW = [
  { min: 740, residence: 0.85, investment: 0.75 },
  { min: 720, residence: 0.8, investment: 0.7 },
  { min: 680, residence: 0.75, investment: 0.65 },
  { min: 660, residence: 0.7, investment: 0.6 },
  { min: 640, residence: 0.6, investment: 0.5 },
];

const PINK = [
  { min: 740, residence: 0.9, investment: 0.75 },
  { min: 720, residence: 0.9, investment: 0.75 },
  { min: 680, residence: 0.85, investment: 0.7 },
];

const NOT_UNSECURED = new Set(["Mortgage", "Home equity loan", "Reverse mortgage"]);

export const NEVER_NOTE = "Never debt free at these payments";
export const BELOW_MINIMUM = "below minimum";
export const WONT_SAVE = "won't save money";

export type ProductGap = { product: string; reason: string };

export type OfferChoice = {
  id: string;
  product: string;
  termMonths: number;
  propertyId: string | null;
  rate: number;
  label: string;
  amount: number;
  debtIds: string[];
  minimum: number;
};

export type MovableDebt = {
  debtId: string;
  name: string;
  rate: number;
  balance: number;
  balanceText: string;
  propertyId: string | null;
  mandatory: boolean;
};

export type CardOrigin = "today" | "builtin" | "advisor";

export type ScenarioCard = {
  id: string;
  kind: "builtin" | "advisor";
  origin: CardOrigin;
  /** The nightly pipeline's best plan. Exactly one card in the workspace. */
  nightly: boolean;
  /** Rule 6 across every scenario in the case, including ones the advisor built. */
  suggested: boolean;
  /** Current path can be recommended only when nothing else beats it. */
  recommendable: boolean;
  badges: string[];
  name: string;
  debtFree: string;
  interest: string;
  monthsSaved: string;
  monthly: string;
  alert: PaymentAlert;
  alertLabel: string;
  note: string | null;
  labels: string[];
  scenarioId: string | null;
};

export type WorkspaceModel = {
  householdId: string;
  name: string;
  cards: ScenarioCard[];
  gaps: ProductGap[];
  choices: OfferChoice[];
  debts: MovableDebt[];
  properties: Property[];
  suggestionId: string;
  suggestionName: string;
  suggestionWhy: string;
};

export type DraftExtra = {
  id: string | null;
  type: ExtraPayment["type"];
  amount: number;
  startMonth: string;
};

export type ScenarioDraft = {
  name: string;
  strategy: "avalanche" | "snowball";
  loanSource: Scenario["loan_source"];
  product: string | null;
  termMonths: number | null;
  loanAmount: number;
  loanRate: number | null;
  debtIds: string[];
  extras: DraftExtra[];
};

export type DraftPreview = {
  debtFree: string;
  interest: string;
  monthly: string;
  alert: PaymentAlert;
  alertLabel: string;
  note: string | null;
  labels: string[];
  months: number | null;
  interestAmount: number;
};

function splitIds(value: string | null): string[] {
  return (value ?? "").split(";").filter((id) => id !== "");
}

function blended(parts: readonly { balance: number; rate: number }[]): number {
  const total = parts.reduce((sum, part) => sum + part.balance, 0);
  if (!total) return 0;
  return parts.reduce((sum, part) => sum + part.balance * part.rate, 0) / total;
}

function termLabel(months: number): string {
  if (months % 12 === 0) return `${months / 12}-year`;
  return `${months} months`;
}

function monthCount(months: number | null): string {
  if (months == null) return NEVER_NOTE;
  return `${months} ${months === 1 ? "month" : "months"}`;
}

/** Months saved against the current path. A path that never finishes has nothing to subtract. */
export function savingsText(current: number | null, months: number | null, baseline: boolean): string {
  if (current == null) return NOT_COMPARABLE;
  if (baseline || months == null) return "—";
  const saved = current - months;
  if (saved <= 0) return "0 months";
  return `${saved} ${saved === 1 ? "month" : "months"}`;
}

export function sourceBadges(card: Pick<ScenarioCard, "origin" | "nightly" | "suggested">): string[] {
  const badges: string[] = [];
  if (card.origin === "today") badges.push("Today");
  if (card.nightly) badges.push("Nightly best");
  else if (card.origin === "builtin") badges.push("Built-in");
  else if (card.origin === "advisor") badges.push("Built by you");
  if (card.suggested) badges.push("Suggested");
  return badges;
}

export function alertLabel(alert: PaymentAlert, percent: number): string {
  if (alert === "none") return "None";
  const name = alert === "amber" ? "Amber" : "Red";
  return `${name} · ${formatPercent(percent)}`;
}

function lowersBlend(state: WorkingHousehold, amount: number, rate: number, debtIds: readonly string[]): boolean {
  if (amount <= 0) return true;
  const valid = validDebts(state.debts);
  const moved = new Set(debtIds);
  const base = valid.map((debt) => ({ balance: debt.balance, rate: debt.rate }));
  const remaining = valid
    .filter((debt) => !moved.has(debt.debt_id))
    .map((debt) => ({ balance: debt.balance, rate: debt.rate }));
  return blended([...remaining, { balance: amount, rate }]) < blended(base);
}

export function loanLabels(
  state: WorkingHousehold,
  source: Scenario["loan_source"],
  product: string | null,
  amount: number,
  rate: number | null,
  debtIds: readonly string[],
): string[] {
  if (source === "none" || amount <= 0 || rate == null) return [];
  const labels: string[] = [];
  const minimum = product ? (MINIMUM[product] ?? 0) : 0;
  if (source === "product" && amount < minimum) labels.push(BELOW_MINIMUM);
  if (!lowersBlend(state, amount, rate, debtIds)) labels.push(WONT_SAVE);
  if (product?.startsWith("HELOAN") && householdFico(state.members).defaulted) labels.push("estimated");
  return labels;
}

function cardFromNumbers(input: {
  id: string;
  kind: ScenarioCard["kind"];
  origin: CardOrigin;
  name: string;
  months: number | null;
  interest: number;
  monthly: number;
  alert: PaymentAlert;
  percent: number;
  currentMonths: number | null;
  baseline: boolean;
  labels: string[];
  scenarioId: string | null;
}): ScenarioCard {
  const unfinished = input.months == null;
  return {
    id: input.id,
    kind: input.kind,
    origin: input.origin,
    nightly: false,
    suggested: false,
    recommendable: input.origin !== "today",
    badges: [],
    name: input.name,
    debtFree: monthCount(input.months),
    interest: unfinished ? NOT_COMPARABLE : formatMoney(input.interest),
    monthsSaved: savingsText(input.currentMonths, input.months, input.baseline),
    monthly: formatMoney(input.monthly),
    alert: input.alert,
    alertLabel: alertLabel(input.alert, input.percent),
    note: unfinished ? NEVER_NOTE : null,
    labels: input.labels,
    scenarioId: input.scenarioId,
  };
}

function scenarioRisk(scenario: Scenario): PlanRisk {
  if (scenario.loan_source === "none") return "none";
  if (scenario.product?.startsWith("HELOAN")) return "secured";
  return "unsecured";
}

function nightlyCardId(bestPlan: string, cards: readonly ScenarioCard[]): string | null {
  if (bestPlan === "Current path") return cards.some((card) => card.id === "current") ? "current" : null;
  if (bestPlan === "Avalanche") return cards.some((card) => card.id === "avalanche") ? "avalanche" : null;
  if (bestPlan === "Snowball") return cards.some((card) => card.id === "snowball") ? "snowball" : null;
  const match = /^(.*) (\d+)m$/.exec(bestPlan);
  if (!match) return null;
  const prefix = `offer:${match[1]}:${match[2]}:`;
  return cards.find((card) => card.id.startsWith(prefix))?.id ?? null;
}

/** Paint the pipeline's best plan onto its card, with the nightly payment alert, and rank the case. */
function settleCards(
  householdId: string,
  cards: ScenarioCard[],
  ranked: { id: string; plan: PlanOption }[],
  currentMonths: number | null,
): { suggestionId: string; suggestionName: string; suggestionWhy: string } {
  const picked = suggestion(ranked.map((row) => row.plan));
  const suggestionId = ranked.find((row) => row.plan === picked.plan)?.id ?? cards[0]?.id ?? "current";
  for (const card of cards) {
    card.suggested = card.id === suggestionId;
    card.recommendable = card.origin !== "today" || card.suggested;
  }

  const nightly = pipelineResults.find((row) => row.household_id === householdId);
  const nightlyId = nightly ? nightlyCardId(nightly.best_plan, cards) : null;
  const nightlyCard = cards.find((card) => card.id === nightlyId);
  if (nightly && nightlyCard) {
    const months = nightly.best_plan_months === "never" ? null : nightly.best_plan_months;
    nightlyCard.nightly = true;
    nightlyCard.debtFree = monthCount(months);
    nightlyCard.interest = months == null ? NOT_COMPARABLE : formatMoney(nightly.best_plan_interest);
    nightlyCard.monthly = formatMoney(nightly.best_plan_monthly);
    nightlyCard.alert = nightly.best_plan_payment_alert;
    nightlyCard.alertLabel = alertLabel(nightly.best_plan_payment_alert, nightly.best_plan_payment_change_pct);
    nightlyCard.note = months == null ? NEVER_NOTE : null;
    nightlyCard.monthsSaved = savingsText(
      currentMonths,
      months,
      nightlyCard.origin === "today",
    );
  }
  for (const card of cards) card.badges = sourceBadges(card);
  const winner = cards.find((card) => card.id === suggestionId);
  return {
    suggestionId,
    suggestionName: winner?.name ?? picked.plan.name,
    suggestionWhy: picked.why,
  };
}

function offerChoices(offers: readonly BuiltOffer[], properties: readonly Property[]): OfferChoice[] {
  const addresses = new Map(properties.map((property) => [property.property_id, property.address]));
  const counts = new Map<string, number>();
  for (const offer of offers) {
    const key = `${offer.product}:${offer.term_months}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return offers.map((offer) => {
    const key = `${offer.product}:${offer.term_months}`;
    const place =
      (counts.get(key) ?? 0) > 1 && offer.property_id
        ? ` · ${addresses.get(offer.property_id) ?? offer.property_id}`
        : "";
    return {
      id: `offer:${offer.product}:${offer.term_months}:${offer.property_id ?? "none"}`,
      product: offer.product,
      termMonths: offer.term_months,
      propertyId: offer.property_id,
      rate: offer.rate,
      label: `${offer.product} ${termLabel(offer.term_months)}${place}`,
      amount: offer.loan_amount,
      debtIds: splitIds(offer.debts_paid_off),
      minimum: MINIMUM[offer.product] ?? 0,
    };
  });
}

function homeEquityReason(state: WorkingHousehold, product: "HELOAN Yellow" | "HELOAN Pink"): string {
  const excluded = product === "HELOAN Yellow" ? new Set(["TX"]) : new Set(["TX", "VT", "IA"]);
  if (excluded.has(state.household.home_state)) return `Not offered in ${state.household.home_state}.`;
  const fico = householdFico(state.members).fico;
  const bands = product === "HELOAN Yellow" ? YELLOW : PINK;
  const band = bands.find((row) => fico >= row.min);
  if (!band) return `FICO ${fico} is below the minimum for ${product}.`;
  if (state.properties.length === 0) return "No property on file.";

  const rows = loanProducts.filter((row) => row.product === product);
  const valid = validDebts(state.debts);
  const unsecured = valid
    .filter((debt) => !debt.property_id && !NOT_UNSECURED.has(debt.debt_type))
    .slice()
    .sort((a, b) => b.rate - a.rate);
  const base = valid.map((debt) => ({ id: debt.debt_id, balance: debt.balance, rate: debt.rate }));
  let sawMortgage = false;
  let sawEquity = false;
  let anyPlain = false;
  let bestAmount = 0;
  let blendBlocked = false;
  const minimum = MINIMUM[product] ?? 0;

  for (const property of state.properties) {
    const onProperty = state.debts.filter((debt) => debt.property_id === property.property_id);
    if (onProperty.some((debt) => debt.debt_type === "Reverse mortgage")) continue;
    anyPlain = true;
    const mortgages = onProperty.filter((debt) => debt.debt_type === "Mortgage");
    if (mortgages.length === 0) continue;
    sawMortgage = true;
    const cltv = property.property_type === "Residence" ? band.residence : band.investment;
    const available = property.value * cltv - mortgages.reduce((sum, debt) => sum + debt.balance, 0);
    const cap =
      product === "HELOAN Yellow"
        ? property.property_type === "Investment" || fico < 680
          ? 350_000
          : 500_000
        : 750_000;
    const limit = Math.min(available, cap);
    if (limit <= 0) continue;
    sawEquity = true;
    const mandatory = onProperty.filter((debt) => debt.debt_type === "Home equity loan");
    for (const row of rows) {
      let amount = mandatory.reduce((sum, debt) => sum + debt.balance, 0);
      if (amount > limit) continue;
      const chosen = [...mandatory];
      for (const debt of unsecured) {
        if (debt.rate > row.rate && amount + debt.balance <= limit) {
          chosen.push(debt);
          amount += debt.balance;
        }
      }
      if (amount > bestAmount) bestAmount = amount;
      if (amount < minimum || chosen.length === 0) continue;
      const moved = new Set(chosen.map((debt) => debt.debt_id));
      const remaining = base.filter((debt) => !moved.has(debt.id));
      const oldBlend = blended(base);
      const nextBlend = blended([...remaining, { balance: amount, rate: row.rate }]);
      if (nextBlend >= oldBlend) blendBlocked = true;
    }
  }

  if (!sawMortgage && !anyPlain) return "A reverse mortgage is on the property.";
  if (!sawMortgage) return "No mortgage is linked to a property.";
  if (!sawEquity) return "Not enough equity.";
  if (blendBlocked && bestAmount >= minimum) return "A loan would not lower the blended rate.";
  if (bestAmount > 0 && bestAmount < minimum) return `Below the ${formatMoney(minimum)} minimum.`;
  return "No debt has a rate high enough to refinance.";
}

export function productGaps(state: WorkingHousehold, offers: readonly BuiltOffer[]): ProductGap[] {
  const gaps: ProductGap[] = [];
  if (!offers.some((offer) => offer.product === "FastApp")) {
    const reason = !state.fastAppApproved
      ? "Not on the FastApp list."
      : (describeFastAppMiss(fastAppMiss(state)) ?? "No FastApp offer.");
    gaps.push({ product: "FastApp", reason });
  }
  for (const product of ["HELOAN Yellow", "HELOAN Pink"] as const) {
    if (offers.some((offer) => offer.product === product)) continue;
    gaps.push({ product, reason: homeEquityReason(state, product) });
  }
  return gaps;
}

export function movableDebts(state: WorkingHousehold, propertyId: string | null): MovableDebt[] {
  const unsecured = validDebts(state.debts)
    .filter((debt) => !debt.property_id && !NOT_UNSECURED.has(debt.debt_type))
    .slice()
    .sort((a, b) => b.rate - a.rate);
  const equity = validDebts(state.debts).filter(
    (debt) => debt.debt_type === "Home equity loan" && (propertyId == null || debt.property_id === propertyId),
  );
  return [...equity, ...unsecured].map((debt) => ({
    debtId: debt.debt_id,
    name: debt.debt_name,
    rate: debt.rate,
    balance: debt.balance,
    balanceText: formatMoney(debt.balance),
    propertyId: debt.property_id,
    mandatory: debt.debt_type === "Home equity loan",
  }));
}

function toScenario(caseId: string, householdId: string, draft: ScenarioDraft, extraIds: string): Scenario {
  return {
    scenario_id: "draft",
    case_id: caseId,
    household_id: householdId,
    name: draft.name,
    strategy: draft.strategy,
    loan_source: draft.loanSource,
    product: draft.loanSource === "product" ? draft.product : null,
    term_months: draft.loanSource === "none" ? null : draft.termMonths,
    loan_amount: draft.loanSource === "none" ? 0 : draft.loanAmount,
    loan_rate: draft.loanSource === "none" ? null : draft.loanRate,
    debts_paid_off: draft.loanSource === "none" ? null : draft.debtIds.join(";") || null,
    extra_payment_ids: extraIds || null,
    created_by: "",
    is_recommended: false,
    advisor_reason: null,
  };
}

/** Live result for the builder. Unsaved extras are included only in this run. */
export function previewDraft(
  state: WorkingHousehold,
  caseId: string,
  caseState: CaseState,
  draft: ScenarioDraft,
): DraftPreview {
  const tempExtras: ExtraPayment[] = draft.extras.map((extra, index) => ({
    extra_id: extra.id ?? `draft-${index}`,
    case_id: caseId,
    household_id: state.household.household_id,
    type: extra.type,
    amount: extra.amount,
    start_month: extra.startMonth,
    end_month: null,
    reason: "",
  }));
  const scenario = toScenario(
    caseId,
    state.household.household_id,
    draft,
    tempExtras.map((extra) => extra.extra_id).join(";"),
  );
  const replaced = new Set(tempExtras.map((extra) => extra.extra_id));
  const result = runScenario(
    state,
    {
      ...caseState,
      extraPayments: [
        ...caseState.extraPayments.filter((extra) => !replaced.has(extra.extra_id)),
        ...tempExtras,
      ],
    },
    scenario,
  );
  const labels = loanLabels(
    state,
    draft.loanSource,
    draft.product,
    draft.loanSource === "none" ? 0 : draft.loanAmount,
    draft.loanRate,
    draft.debtIds,
  );
  return {
    debtFree: result.months == null ? NEVER_NOTE : monthCount(result.months),
    interest: formatMoney(result.totalInterest),
    monthly: formatMoney(result.requiredMonthly),
    alert: result.paymentAlert,
    alertLabel: alertLabel(result.paymentAlert, result.paymentChangePct),
    note: result.months == null ? NEVER_NOTE : null,
    labels,
    months: result.months,
    interestAmount: result.totalInterest,
  };
}

export function assembleWorkspace(
  state: WorkingHousehold,
  scenarios: readonly Scenario[],
  caseState: CaseState,
): WorkspaceModel {
  const plans = builtInPlans(state, { schedule: false });
  const offers = buildOffers(state);
  const choices = offerChoices(offers, state.properties);
  const scoreEstimated = householdFico(state.members).defaulted;
  const currentMonths = plans.current.months;
  const pay = todayPayment(state.debts);
  const ranked: { id: string; plan: PlanOption }[] = [
    { id: "current", plan: plans.current },
    { id: "avalanche", plan: plans.avalanche },
    { id: "snowball", plan: plans.snowball },
  ];
  const cards: ScenarioCard[] = [
    cardFromNumbers({
      id: "current",
      kind: "builtin",
      origin: "today",
      name: "Current path",
      months: plans.current.months,
      interest: plans.current.interest,
      monthly: pay,
      alert: "none",
      percent: 0,
      currentMonths,
      baseline: true,
      labels: [],
      scenarioId: null,
    }),
    cardFromNumbers({
      id: "avalanche",
      kind: "builtin",
      origin: "builtin",
      name: "Avalanche",
      months: plans.avalanche.months,
      interest: plans.avalanche.interest,
      monthly: pay,
      alert: "none",
      percent: 0,
      currentMonths,
      baseline: false,
      labels: [],
      scenarioId: null,
    }),
    cardFromNumbers({
      id: "snowball",
      kind: "builtin",
      origin: "builtin",
      name: "Snowball",
      months: plans.snowball.months,
      interest: plans.snowball.interest,
      monthly: pay,
      alert: "none",
      percent: 0,
      currentMonths,
      baseline: false,
      labels: [],
      scenarioId: null,
    }),
  ];

  for (const choice of choices) {
    const offer = offers.find(
      (row) =>
        row.product === choice.product &&
        row.term_months === choice.termMonths &&
        (row.property_id ?? "none") === (choice.propertyId ?? "none"),
    );
    if (!offer) continue;
    cards.push(
      cardFromNumbers({
        id: choice.id,
        kind: "builtin",
        origin: "builtin",
        name: choice.label,
        months: offer.months,
        interest: offer.total_interest,
        monthly: Math.max(pay, offer.contractual_monthly),
        alert: offer.payment_alert,
        percent: offer.payment_change_pct,
        currentMonths,
        baseline: false,
        labels: scoreEstimated && choice.product.startsWith("HELOAN") ? ["estimated"] : [],
        scenarioId: null,
      }),
    );
  }

  const best = bestOffer(offers);
  if (best) {
    const id = `offer:${best.product}:${best.term_months}:${best.property_id ?? "none"}`;
    ranked.push({
      id,
      plan: {
        name: choices.find((choice) => choice.id === id)?.label ?? `${best.product} ${best.term_months}m`,
        months: best.months,
        interest: best.total_interest,
        contractual: best.contractual_monthly,
        risk: best.security,
        schedule: [],
        payoffOrder: [],
      },
    });
  }

  for (const scenario of scenarios) {
    const result = runScenario(state, caseState, scenario);
    ranked.push({
      id: scenario.scenario_id,
      plan: {
        name: scenario.name,
        months: result.months,
        interest: result.totalInterest,
        contractual: result.contractualMonthly,
        risk: scenarioRisk(scenario),
        schedule: [],
        payoffOrder: [],
      },
    });
    cards.push(
      cardFromNumbers({
        id: scenario.scenario_id,
        kind: "advisor",
        origin: "advisor",
        name: scenario.name,
        months: result.months,
        interest: result.totalInterest,
        monthly: result.requiredMonthly,
        alert: result.paymentAlert,
        percent: result.paymentChangePct,
        currentMonths,
        baseline: false,
        labels: loanLabels(
          state,
          scenario.loan_source,
          scenario.product,
          scenario.loan_amount,
          scenario.loan_rate,
          splitIds(scenario.debts_paid_off),
        ),
        scenarioId: scenario.scenario_id,
      }),
    );
  }

  const settled = settleCards(state.household.household_id, cards, ranked, currentMonths);
  return {
    householdId: state.household.household_id,
    name: state.household.household_name,
    cards,
    gaps: productGaps(state, offers),
    choices,
    debts: movableDebts(state, null),
    properties: state.properties,
    suggestionId: settled.suggestionId,
    suggestionName: settled.suggestionName,
    suggestionWhy: settled.suggestionWhy,
  };
}

export function workspaceFor(
  householdId: string,
  caseId: string | null,
  caseState: CaseState,
  scenarios: readonly Scenario[],
): WorkspaceModel | null {
  const overrides = caseId == null ? [] : caseState.overrides.filter((row) => row.case_id === caseId);
  const scoped = { ...caseState, overrides };
  let state: WorkingHousehold;
  try {
    state = householdWithCase(householdId, scoped);
  } catch {
    return null;
  }
  const rows = scenarios.filter((scenario) => caseId != null && scenario.case_id === caseId);
  return assembleWorkspace(state, rows, scoped);
}

export function previewHousehold(
  householdId: string,
  caseId: string,
  caseState: CaseState,
  draft: ScenarioDraft,
): DraftPreview | null {
  const overrides = caseState.overrides.filter((row) => row.case_id === caseId);
  try {
    const state = householdWithCase(householdId, { ...caseState, overrides });
    return previewDraft(state, caseId, { ...caseState, overrides }, draft);
  } catch {
    return null;
  }
}

export function rateText(rate: number): string {
  const text = rate.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${text}%`;
}
