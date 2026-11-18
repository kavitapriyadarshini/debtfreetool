import { DEFAULT_FICO } from "../config";
import {
  debtsOf,
  getHousehold,
  isFastAppApproved,
  membersOf,
  propertiesOf,
} from "../data";
import type { DataFlag, Debt, Household, Member, Property } from "../types";

export type FlagHit = {
  flag: DataFlag;
  /** Empty string when the flag is about the household rather than one record. */
  entityId: string;
};

export type FicoResult = {
  fico: number;
  defaulted: boolean;
};

/** Source rows for one household, copied so case edits never write back to the JSON. */
export type WorkingHousehold = {
  household: Household;
  members: Member[];
  debts: Debt[];
  properties: Property[];
  fastAppApproved: boolean;
};

export function loadHousehold(id: string): WorkingHousehold {
  const household = getHousehold(id);
  if (!household) throw new Error(`Unknown household ${id}`);
  return {
    household: { ...household },
    members: membersOf(id).map((member) => ({ ...member })),
    debts: debtsOf(id).map((debt) => ({ ...debt })),
    properties: propertiesOf(id).map((property) => ({ ...property })),
    fastAppApproved: isFastAppApproved(id),
  };
}

export function asWorking(household: string | Household | WorkingHousehold): WorkingHousehold {
  if (typeof household === "string") return loadHousehold(household);
  if ("debts" in household) return household;
  return loadHousehold(household.household_id);
}

export function validDebts(debts: readonly Debt[]): Debt[] {
  return debts.filter((debt) => debt.monthly_payment > 0);
}

export function excludedDebts(debts: readonly Debt[]): Debt[] {
  return debts.filter((debt) => debt.monthly_payment <= 0);
}

export function todayPayment(debts: readonly Debt[]): number {
  return validDebts(debts).reduce((sum, debt) => sum + debt.monthly_payment, 0);
}

/** Lowest score that exists. 740, flagged, when nobody has a score. */
export function householdFico(members: readonly Member[]): FicoResult {
  const scores = members.flatMap((member) => (member.fico == null ? [] : [member.fico]));
  if (scores.length === 0) return { fico: DEFAULT_FICO, defaulted: true };
  return { fico: Math.min(...scores), defaulted: false };
}

const SECURED_TYPES = new Set(["Mortgage", "Home equity loan"]);

/** ENGINE.md section 6, in the same order the reference pipeline emits them. */
export function flags(
  household: Household,
  members: readonly Member[],
  debts: readonly Debt[],
  properties: readonly Property[],
): FlagHit[] {
  const found: FlagHit[] = [];
  const valid: Debt[] = [];

  for (const debt of debts) {
    if (debt.monthly_payment <= 0) {
      found.push({ flag: "zero_payment", entityId: debt.debt_id });
      continue;
    }
    valid.push(debt);
    if (debt.rate === 0) found.push({ flag: "zero_rate", entityId: debt.debt_id });
    if (debt.monthly_payment < (debt.balance * debt.rate) / 1200) {
      found.push({ flag: "payment_below_interest", entityId: debt.debt_id });
    }
  }

  const seen = new Map<string, string>();
  for (const debt of valid) {
    const key = `${debt.debt_name}\0${debt.balance}\0${debt.rate}\0${debt.monthly_payment}`;
    const first = seen.get(key);
    if (first) found.push({ flag: "possible_duplicate", entityId: `${first};${debt.debt_id}` });
    else seen.set(key, debt.debt_id);
  }

  if (householdFico(members).defaulted) found.push({ flag: "no_fico_any_member", entityId: "" });
  if (household.comfort_zone == null) found.push({ flag: "missing_comfort_zone", entityId: "" });

  const payTotal = valid.reduce((sum, debt) => sum + debt.monthly_payment, 0);
  if (household.annual_income == null) found.push({ flag: "income_missing", entityId: "" });
  else if (payTotal * 12 > household.annual_income) {
    found.push({ flag: "income_implausible", entityId: "" });
  }

  for (const property of properties) {
    if (property.value_as_of < "2024-01-01") {
      found.push({ flag: "stale_property_value", entityId: property.property_id });
    }
  }

  for (const debt of valid) {
    if (SECURED_TYPES.has(debt.debt_type) && !debt.property_id) {
      found.push({ flag: "mortgage_unlinked", entityId: debt.debt_id });
    }
  }

  return found;
}
