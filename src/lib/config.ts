/** Demo "today". Waiting periods and ready dates are measured from this date. */
export const AS_OF = "2026-11-14";

/** Plan month 1. Engine month index 1. */
export const PLAN_START = "2026-12";

/** Households shown on one page of the opportunity list. */
export const PAGE_SIZE = 25;

/** A payment rise above this fraction of today's payment is an amber alert. */
export const ALERT_AMBER = 0.1;

/** A payment rise above this fraction of today's payment is a red alert. */
export const ALERT_RED = 0.25;

/** Plans within this many months of the fastest count as a tie. */
export const TIE_WINDOW_MONTHS = 1;

/** Months simulated before a plan is treated as never paying off. */
export const CAP_MONTHS = 600;

/** FICO used when no member of the household has a score. */
export const DEFAULT_FICO = 740;

/**
 * Days before the next proactive offer.
 * Order matches the spec: presented, declined or undecided / agreed with no
 * new loan / agreed with a new loan.
 */
export const WAITING_PERIODS = {
  presentedDeclinedOrUndecided: 90,
  agreedNoLoan: 90,
  agreedWithLoan: 365,
} as const;
