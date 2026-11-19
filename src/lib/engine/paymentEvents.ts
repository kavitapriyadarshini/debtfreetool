import { formatMoney, planDate } from "../format";
import type { ExtraInput, ScheduleRow, Strategy } from "./simulate";

const PAID = 0.005;

const BRANDS = ["Bank of America", "Capital One", "Wells Fargo", "US Bank", "Credit One", "Best Egg", "Sallie Mae", "Mr. Cooper"];

export type PaymentDebt = {
  id: string;
  name: string;
  payment: number;
  rate: number;
  balance: number;
};

export type LoanStart = {
  amount: number;
  /** Contractual monthly payment, in whole dollars. */
  payment: number;
};

/** A debt paid off, and the payment that then follows the plan's next target. */
export type RolloverEvent = {
  month: number;
  event: "rollover";
  debtId: string;
  payment: number;
  targetId: string;
  targetPayment: number;
};

/** Month 1 of a loan: debts it clears, the payment that stops, and where the difference goes. */
export type LoanEvent = {
  month: number;
  event: "loan";
  amount: number;
  paidOffIds: string[];
  stopped: number;
  loanPayment: number;
  difference: number;
  targetId: string | null;
};

/** An extra payment starting (recurring) or landing (one-off). */
export type ExtraEvent = {
  month: number;
  event: "extra";
  extraType: ExtraInput["type"];
  amount: number;
  targetId: string | null;
};

export type PaymentEvent = RolloverEvent | LoanEvent | ExtraEvent;

export type PaymentEventInput = {
  schedule: readonly ScheduleRow[];
  /** Debts in the simulation, including the new loan when there is one. */
  debts: readonly PaymentDebt[];
  /** Debts the new loan clears in month 1, in the order they are named. */
  paidOff?: readonly PaymentDebt[];
  loan?: LoanStart | null;
  strategy: Strategy;
  extras?: readonly ExtraInput[];
};

/** The lender, short enough for a sentence. "Capital One Quicksilver" becomes "Capital One". */
export function lenderName(name: string): string {
  const brand = BRANDS.find((row) => name === row || name.startsWith(`${row} `));
  if (brand) return brand;
  return name.split(" ")[0] || name;
}

function joinAnd(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function reason(strategy: Strategy): string {
  return strategy === "snowball" ? "the smallest balance left" : "the highest rate left";
}

function pickTarget(
  ids: readonly string[],
  facts: ReadonlyMap<string, PaymentDebt>,
  openings: ReadonlyMap<string, number>,
  strategy: Strategy,
): string | null {
  if (ids.length === 0) return null;
  let best = ids[0]!;
  for (const id of ids.slice(1)) {
    if (strategy === "snowball") {
      const balance = openings.get(id) ?? facts.get(id)?.balance ?? 0;
      const bestBalance = openings.get(best) ?? facts.get(best)?.balance ?? 0;
      if (balance < bestBalance) best = id;
    } else if ((facts.get(id)?.rate ?? 0) > (facts.get(best)?.rate ?? 0)) {
      best = id;
    }
  }
  return best;
}

function recurringActive(extras: readonly ExtraInput[], month: number): number {
  return extras
    .filter(
      (extra) =>
        extra.type === "recurring" &&
        extra.startIndex <= month &&
        (extra.endIndex == null || month <= extra.endIndex),
    )
    .reduce((sum, extra) => sum + extra.amount, 0);
}

/**
 * Payment changes read off the month-by-month schedule.
 * A paid-off debt's contractual payment moves to the debt the plan targets next.
 * A new loan is the month-1 change. An extra is recorded in the month it starts or lands.
 */
export function paymentEvents(input: PaymentEventInput): PaymentEvent[] {
  const facts = new Map(input.debts.map((debt) => [debt.id, debt]));
  const extras = input.extras ?? [];
  const assigned = new Map(input.debts.map((debt) => [debt.id, debt.payment]));
  const events: PaymentEvent[] = [];
  const paidOff = input.paidOff ?? [];
  const loan = input.loan ?? null;

  for (const row of input.schedule) {
    const openings = new Map(row.debts.map((debt) => [debt.id, debt.openingBalance]));
    const open = row.debts.filter((debt) => debt.closingBalance > PAID).map((debt) => debt.id);

    if (row.month === 1 && loan && paidOff.length > 0) {
      const stopped = paidOff.reduce((sum, debt) => sum + debt.payment, 0);
      const difference = stopped - loan.payment;
      let targetId: string | null = null;
      let bestExcess = 0;
      for (const debt of row.debts) {
        const excess = debt.payment - (assigned.get(debt.id) ?? 0);
        if (excess > bestExcess + 0.5) {
          bestExcess = excess;
          targetId = debt.id;
        }
      }
      if (targetId && difference > 0.5) assigned.set(targetId, (assigned.get(targetId) ?? 0) + difference);
      events.push({
        month: 1,
        event: "loan",
        amount: loan.amount,
        paidOffIds: paidOff.map((debt) => debt.id),
        stopped,
        loanPayment: loan.payment,
        difference,
        targetId: difference > 0.5 ? targetId : null,
      });
    }

    for (const extra of extras) {
      const start = Math.max(extra.startIndex, 1);
      if (start !== row.month) continue;
      const targetId = pickTarget(open.length > 0 ? open : row.debts.map((debt) => debt.id), facts, openings, input.strategy);
      events.push({
        month: row.month,
        event: "extra",
        extraType: extra.type,
        amount: extra.amount,
        targetId,
      });
    }

    if (input.strategy === "current") continue;
    const closed = row.debts.filter((debt) => debt.closingBalance <= PAID);
    for (const debt of closed) {
      const moved = assigned.get(debt.id) ?? 0;
      assigned.delete(debt.id);
      if (open.length === 0 || moved < 0.5) continue;
      const targetId = pickTarget(open, facts, openings, input.strategy);
      if (!targetId) continue;
      const next = (assigned.get(targetId) ?? 0) + moved;
      assigned.set(targetId, next);
      events.push({
        month: row.month,
        event: "rollover",
        debtId: debt.id,
        payment: moved,
        targetId,
        targetPayment: next + recurringActive(extras, row.month + 1),
      });
    }
  }

  return events;
}

function destination(id: string, names: ReadonlyMap<string, string>): string {
  if (id === "NEW_LOAN") return "the new loan";
  return lenderName(names.get(id) ?? id);
}

/** One plain sentence for a payment event. */
export function describePaymentEvent(event: PaymentEvent, names: ReadonlyMap<string, string>, strategy: Strategy): string {
  if (event.event === "loan") {
    const paid = event.paidOffIds.map((id) => destination(id, names));
    const pronoun = paid.length === 1 ? "its" : "their";
    const where =
      event.targetId && Math.round(event.difference) > 0
        ? `; the other ${formatMoney(event.difference)} goes to ${destination(event.targetId, names)}, ${reason(strategy)}`
        : "";
    return `New loan of ${formatMoney(event.amount)} pays off ${joinAnd(paid)}; ${pronoun} ${formatMoney(event.stopped)} a month stops; the loan's ${formatMoney(event.loanPayment)} starts${where}.`;
  }
  if (event.event === "extra") {
    const where = event.targetId ? `${destination(event.targetId, names)}, ${reason(strategy)}` : "";
    if (event.extraType === "one_off") {
      const lands = where ? ` on ${where}` : "";
      return `${planDate(event.month)}: A ${formatMoney(event.amount)} lump sum lands${lands}.`;
    }
    const starts = where ? ` and goes to ${where}` : "";
    return `${planDate(event.month)}: An extra ${formatMoney(event.amount)} a month starts${starts}.`;
  }
  const paid = event.debtId === "NEW_LOAN" ? "The new loan" : destination(event.debtId, names);
  return `${planDate(event.month)}: ${paid} paid off; its ${formatMoney(event.payment)} a month moves to ${destination(event.targetId, names)}, now ${formatMoney(event.targetPayment)}.`;
}

export function paymentEventLines(input: PaymentEventInput): string[] {
  const names = new Map([...input.debts, ...(input.paidOff ?? [])].map((debt) => [debt.id, debt.name]));
  return paymentEvents(input).map((event) => describePaymentEvent(event, names, input.strategy));
}
