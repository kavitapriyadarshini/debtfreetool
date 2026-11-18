import { CAP_MONTHS, PLAN_START } from "../config";
import { pythonRound } from "./round";

export type Strategy = "current" | "avalanche" | "snowball";

export type SimDebt = {
  id: string;
  balance: number;
  rate: number;
  payment: number;
};

export type ExtraInput = {
  type: "one_off" | "recurring";
  amount: number;
  /** Plan month index. December 2026 is 1. */
  startIndex: number;
  endIndex?: number | null;
};

export type DebtMonth = {
  id: string;
  openingBalance: number;
  interest: number;
  payment: number;
  closingBalance: number;
};

export type ScheduleRow = {
  month: number;
  debts: DebtMonth[];
};

export type SimulationResult = {
  /** Null when a balance remains after the 600-month cap. */
  months: number | null;
  totalInterest: number;
  payoffOrder: string[];
  schedule: ScheduleRow[];
};

const BALANCE_EPSILON = 0.005;

/** `'2026-12'` is 1, `'2027-01'` is 2, measured from PLAN_START. */
export function monthIndex(yearMonth: string): number {
  const [year, month] = yearMonth.split("-").map(Number);
  const [startYear, startMonth] = PLAN_START.split("-").map(Number);
  return (year! - startYear!) * 12 + (month! - startMonth!) + 1;
}

function extraDue(extra: ExtraInput, month: number): boolean {
  if (extra.type === "one_off") return extra.startIndex === month;
  return extra.startIndex <= month && (extra.endIndex == null || month <= extra.endIndex);
}

/** Highest rate, or smallest balance for snowball. Equal keys keep the earlier debt. */
function pickTarget(debts: readonly SimDebt[], strategy: Strategy): SimDebt {
  let best = debts[0]!;
  for (let index = 1; index < debts.length; index += 1) {
    const debt = debts[index]!;
    if (strategy === "snowball") {
      if (debt.balance < best.balance) best = debt;
    } else if (debt.rate > best.rate) {
      best = debt;
    }
  }
  return best;
}

/**
 * One month at a time, in debt-list order. ENGINE.md section 2.
 * `budget` defaults to the sum of the payments. Extras are optional.
 */
export function simulate(
  debts: readonly SimDebt[],
  strategy: Strategy,
  budget?: number,
  extras: readonly ExtraInput[] = [],
  options?: { schedule?: boolean },
): SimulationResult {
  const recordSchedule = options?.schedule !== false;
  const live: SimDebt[] = debts.filter((debt) => debt.balance > 0).map((debt) => ({ ...debt }));
  if (live.length === 0) {
    return { months: 0, totalInterest: 0, payoffOrder: [], schedule: [] };
  }

  const spendBudget = budget ?? live.reduce((sum, debt) => sum + debt.payment, 0);
  let totalInterest = 0;
  const payoffOrder: string[] = [];
  const schedule: ScheduleRow[] = [];
  let month = 0;

  while (live.length > 0 && month < CAP_MONTHS) {
    month += 1;
    const opening = recordSchedule ? live.map((debt) => debt.balance) : [];
    const interestPaid = live.map(() => 0);
    for (let index = 0; index < live.length; index += 1) {
      const debt = live[index]!;
      const interest = (debt.balance * debt.rate) / 1200;
      debt.balance += interest;
      totalInterest += interest;
      interestPaid[index] = interest;
    }

    const paid = live.map(() => 0);
    let spent = 0;
    for (let index = 0; index < live.length; index += 1) {
      const debt = live[index]!;
      const payment = Math.min(debt.payment, debt.balance);
      debt.balance -= payment;
      spent += payment;
      paid[index] = payment;
    }

    let left = strategy === "current" ? 0 : spendBudget - spent;
    for (const extra of extras) {
      if (extraDue(extra, month)) left += extra.amount;
    }

    while (left > BALANCE_EPSILON) {
      const active = live.filter((debt) => debt.balance > BALANCE_EPSILON);
      if (active.length === 0) break;
      const target = pickTarget(active, strategy);
      const payment = Math.min(left, target.balance);
      target.balance -= payment;
      left -= payment;
      const index = live.indexOf(target);
      paid[index] = (paid[index] ?? 0) + payment;
    }

    if (recordSchedule) {
      schedule.push({
        month,
        debts: live.map((debt, index) => ({
          id: debt.id,
          openingBalance: opening[index]!,
          interest: interestPaid[index]!,
          payment: paid[index]!,
          closingBalance: debt.balance,
        })),
      });
    }

    for (const debt of live) {
      if (debt.balance <= BALANCE_EPSILON) payoffOrder.push(debt.id);
    }
    const remaining = live.filter((debt) => debt.balance > BALANCE_EPSILON);
    live.length = 0;
    live.push(...remaining);
  }

  return {
    months: live.length > 0 ? null : month,
    totalInterest: pythonRound(totalInterest),
    payoffOrder,
    schedule,
  };
}
