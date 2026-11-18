/** A CSV cell after build-data parsing. */
export type ParsedCell = string | number | boolean | null;

export type PaymentAlert = "none" | "amber" | "red";

export type OutreachStatus = "ready" | "waiting" | "progress_check_due";

export type CaseStatus = "in_progress" | "proposed" | "agreed" | "declined" | "undecided";

export type Decision = "agreed" | "declined" | "undecided";

export type ContactChannel = "servicing_call" | "advisor_outreach" | "household_request";

export type ContactOutcome = "agreed" | "declined" | "undecided" | "presented" | "no_offer";

export type DataFlag =
  | "zero_payment"
  | "zero_rate"
  | "payment_below_interest"
  | "possible_duplicate"
  | "no_fico_any_member"
  | "missing_comfort_zone"
  | "income_missing"
  | "income_implausible"
  | "stale_property_value"
  | "mortgage_unlinked";

/** Months from the pipeline. `never` means a balance remained after the 600-month cap. */
export type MonthsOrNever = number | "never";

export type Household = {
  household_id: string;
  household_name: string;
  advisor: string;
  branch: string;
  home_state: string;
  comfort_zone: number | null;
  annual_income: number | null;
};

export type Member = {
  member_id: string;
  household_id: string;
  member_name: string;
  role: "Primary" | "Spouse";
  fico: number | null;
};

export type Debt = {
  debt_id: string;
  household_id: string;
  debt_name: string;
  debt_type: string;
  balance: number;
  rate: number;
  monthly_payment: number;
  property_id: string | null;
  last_updated: string;
};

export type Property = {
  property_id: string;
  household_id: string;
  address: string;
  value: number;
  property_type: "Residence" | "Investment";
  value_as_of: string;
};

export type FastAppApproval = {
  household_id: string;
  approved_on: string;
};

export type LoanProduct = {
  product: string;
  term_months: number;
  comfort_zone: number | "All";
  rate: number;
  rates_as_of: string;
};

export type PipelineResult = {
  household_id: string;
  advisor: string;
  branch: string;
  fico_used: number;
  fico_defaulted: boolean;
  valid_debts: number;
  excluded_debts: number;
  total_balance: number;
  current_monthly: number;
  current_months: MonthsOrNever;
  current_interest: number;
  avalanche_months: MonthsOrNever;
  avalanche_interest: number;
  snowball_months: MonthsOrNever;
  snowball_interest: number;
  offers: number;
  best_offer: string | null;
  best_plan: string;
  best_plan_months: MonthsOrNever;
  best_plan_interest: number;
  best_plan_monthly: number;
  best_plan_payment_change_pct: number;
  best_plan_payment_alert: PaymentAlert;
  months_saved: number | "from never";
  interest_saved: number | "n/a";
  status: "opportunity" | "no_action_needed";
  fastapp_preapproved_no_offer: boolean;
  flags: string | null;
  advisor_rank: number;
};

export type PipelineOffer = {
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
};

export type PipelineFlag = {
  household_id: string;
  entity_id: string | null;
  flag: DataFlag;
};

export type Case = {
  case_id: string;
  household_id: string;
  advisor: string;
  branch: string;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
  version: number;
  recommended_scenario_id: string | null;
  recommended_payment_alert: PaymentAlert | null;
  payment_alert_acknowledged: boolean;
  tool_suggested_scenario_id: string;
  recommendation_differs_from_suggestion: boolean;
  decision: Decision | null;
  decision_at: string | null;
};

export type CaseHistoryEvent = {
  case_id: string;
  seq: number;
  event: string;
  ref_id: string | null;
  by: string;
  at: string;
  /** Reason recorded with a recommendation or an alert acknowledgement. */
  note?: string | null;
};

export type Scenario = {
  scenario_id: string;
  case_id: string;
  household_id: string;
  name: string;
  strategy: "current" | "avalanche" | "snowball";
  loan_source: "none" | "product" | "custom";
  product: string | null;
  term_months: number | null;
  loan_amount: number;
  loan_rate: number | null;
  debts_paid_off: string | null;
  extra_payment_ids: string | null;
  created_by: string;
  is_recommended: boolean;
  advisor_reason: string | null;
};

export type ScenarioResult = {
  scenario_id: string;
  case_id: string;
  household_id: string;
  months_to_debt_free: MonthsOrNever;
  total_interest: number;
  monthly_payment: number;
  contractual_monthly: number;
  required_monthly: number;
  today_monthly: number;
  payment_change_pct: number;
  payment_alert: PaymentAlert;
};

export type ExtraPayment = {
  extra_id: string;
  case_id: string;
  household_id: string;
  type: "one_off" | "recurring";
  amount: number;
  start_month: string;
  end_month: string | null;
  reason: string;
};

export type CaseOverride = {
  override_id: string;
  case_id: string;
  household_id: string;
  entity_type: "debt" | "property" | "member" | "household";
  entity_id: string;
  field: string;
  source_value: ParsedCell;
  override_value: ParsedCell;
  reason: string;
  reported_to_backend: boolean;
  changed_by: string;
  changed_at: string;
};

export type CustomLoan = {
  custom_loan_id: string;
  case_id: string;
  household_id: string;
  lender_name: string;
  rate: number;
  term_months: number;
  max_amount: number;
  note: string;
};

export type ContactEvent = {
  contact_id: string;
  household_id: string;
  advisor: string;
  contacted_at: string;
  channel: ContactChannel;
  initiated_by: "advisor" | "household";
  plan_presented: boolean;
  outcome: ContactOutcome;
  includes_new_loan: boolean | null;
  case_id: string | null;
  scenario_id: string | null;
  inside_cooling_off_override_reason: string | null;
};

export type HouseholdOutreach = {
  household_id: string;
  advisor: string;
  last_contacted_at: string | null;
  days_since_last_contact: number | null;
  last_contact_channel: ContactChannel | null;
  last_offer_at: string | null;
  last_offer_outcome: Exclude<ContactOutcome, "no_offer"> | null;
  last_offer_included_loan: boolean | null;
  cooling_off_rule:
    | "agreed_loan_365d"
    | "agreed_no_loan_90d"
    | "presented_90d"
    | "declined_90d"
    | "undecided_90d"
    | null;
  eligible_for_outreach_from: string | null;
  days_until_eligible: number;
  outreach_status: OutreachStatus;
};

export type QaExpectedDataIssue = {
  household_id: string;
  entity_id: string | null;
  issue_type: string;
  rule: string;
};
