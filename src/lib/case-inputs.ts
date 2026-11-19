import { bestOffer, builtInPlans, type PlanOption } from "./engine/bestPlan";
import { buildOffers } from "./engine/offers";
import { casePreview } from "./engine/scenario";
import type { WorkingHousehold } from "./engine/household";
import type { CaseOverride, Scenario } from "./types";

/**
 * Source data plus this case's corrections to today's facts.
 * The current path is calculated here, once, and nothing else may replace it.
 */
export type CaseInputs = {
  /** Debts still listed, including ones the case excludes from plans. */
  household: WorkingHousehold;
  /** The household plans actually run on. Excluded debts are already gone. */
  planned: WorkingHousehold;
  excluded: ReadonlySet<string>;
  /** True when this case version changes a fact the plans use. */
  edited: boolean;
  plans: ReturnType<typeof builtInPlans>;
  /** Frozen. Loans, extras and later recalculations do not replace this. */
  current: PlanOption;
};

/** One fingerprint for a plan's inputs, so two plans that use the same ones can share a column. */
export function planKey(input: {
  strategy: string;
  loanSource: string;
  product: string | null;
  termMonths: number | null;
  amount: number;
  rate: number | null;
  debtIds: readonly string[];
  extraIds: readonly string[];
}): string {
  const rate = input.rate == null ? "" : String(Math.round(input.rate * 1000) / 1000);
  return [
    input.strategy,
    input.loanSource,
    input.product ?? "",
    input.termMonths ?? "",
    Math.round(input.amount),
    rate,
    [...input.debtIds].filter((id) => id !== "").sort().join(","),
    [...input.extraIds].filter((id) => id !== "").sort().join(","),
  ].join("|");
}

const EDITED_SUFFIX = " (edited data)";
const NIGHTLY_SUFFIX = " (nightly best)";

/** A case has edits only when the store holds at least one override for it. */
export function hasCaseEdits(overrides: readonly { case_id?: string }[]): boolean {
  return overrides.length > 0;
}

/** Plan names carry the suffix only while the case has an edit, and lose it when the last one is removed. */
export function editedName(name: string, edited: boolean): string {
  const bare = name.replace(/\s*\(edited data\)\s*$/i, "");
  return edited ? `${bare}${EDITED_SUFFIX}` : bare;
}

/**
 * Seeded titles that describe an edit or the nightly best, cleaned before plans are shown.
 * "Avalanche (edited data)" becomes "Avalanche" only when that case has no overrides, so it
 * matches the built-in avalanche and shares its column. A trailing " (nightly best)" is
 * always dropped; the Pipeline recommended badge already says it.
 */
export function normalizeSeededScenarios<T extends Pick<Scenario, "case_id" | "name">>(
  scenarios: readonly T[],
  overrides: readonly Pick<CaseOverride, "case_id">[],
): T[] {
  const editedCases = new Set(overrides.map((row) => row.case_id));
  return scenarios.map((scenario) => {
    let name = scenario.name;
    if (name.endsWith(NIGHTLY_SUFFIX)) name = name.slice(0, -NIGHTLY_SUFFIX.length);
    if (!editedCases.has(scenario.case_id) && name === `Avalanche${EDITED_SUFFIX}`) name = "Avalanche";
    return name === scenario.name ? scenario : { ...scenario, name };
  });
}

/** Source household with this case's fact overrides. Extras and loans are not applied. */
export function caseInputs(householdId: string, overrides: readonly CaseOverride[]): CaseInputs | null {
  let preview: ReturnType<typeof casePreview>;
  try {
    preview = casePreview(householdId, overrides);
  } catch {
    return null;
  }
  const planned: WorkingHousehold = {
    ...preview.state,
    debts: preview.state.debts.filter((debt) => !preview.excluded.has(debt.debt_id)),
  };
  const plans = builtInPlans(planned, { schedule: false });
  return {
    household: preview.state,
    planned,
    excluded: preview.excluded,
    edited: hasCaseEdits(overrides),
    plans,
    current: plans.current,
  };
}

/** The nightly best plan's strategy, recalculated on these case inputs. */
export function nightlyOnCase(
  inputs: CaseInputs,
  bestPlanName: string,
): { months: number | null; interest: number } | null {
  if (bestPlanName === "Current path") return inputs.current;
  if (bestPlanName === "Avalanche") return inputs.plans.avalanche;
  if (bestPlanName === "Snowball") return inputs.plans.snowball;
  const parsed = /^(.*) (\d+)m$/.exec(bestPlanName);
  if (!parsed) return null;
  const product = parsed[1] ?? "";
  const term = Number(parsed[2]);
  const matches = buildOffers(inputs.planned).filter(
    (offer) => offer.product === product && offer.term_months === term,
  );
  const best = bestOffer(matches);
  if (!best) return null;
  return { months: best.months, interest: best.total_interest };
}

export function savingsAgainst(
  current: PlanOption,
  plan: { months: number | null; interest: number },
): { monthsSaved: number | "from never"; interestSaved: number | "n/a" } {
  if (current.months == null) return { monthsSaved: "from never", interestSaved: "n/a" };
  if (plan.months == null) return { monthsSaved: "from never", interestSaved: "n/a" };
  return {
    monthsSaved: current.months - plan.months,
    interestSaved: Math.round(current.interest) - Math.round(plan.interest),
  };
}
