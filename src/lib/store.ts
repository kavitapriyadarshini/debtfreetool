"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { normalizeSeededScenarios } from "./case-inputs";
import { AS_OF } from "./config";
import {
  caseHistory as seedHistory,
  caseOverrides as seedOverrides,
  cases as seedCases,
  contacts as seedContacts,
  customLoans as seedLoans,
  extraPayments as seedExtras,
  getHousehold,
  scenarios as seedScenarios,
} from "./data";
import { planDecision } from "./decision";
import { bestPlan, type PlanOption, type PlanRisk } from "./engine/bestPlan";
import { runScenario } from "./engine/scenario";
import type { FrozenSnapshot } from "./snapshot";
import type {
  Case,
  CaseHistoryEvent,
  CaseOverride,
  ContactChannel,
  ContactEvent,
  ContactOutcome,
  CustomLoan,
  Decision,
  ExtraPayment,
  ParsedCell,
  Scenario,
} from "./types";
import { defaultUser, type DemoUser } from "./users";

type DemoData = {
  cases: Case[];
  caseHistory: CaseHistoryEvent[];
  scenarios: Scenario[];
  extraPayments: ExtraPayment[];
  caseOverrides: CaseOverride[];
  customLoans: CustomLoan[];
  contacts: ContactEvent[];
  snapshots: FrozenSnapshot[];
};

export type NewScenario = {
  caseId: string;
  householdId: string;
  name: string;
  strategy: Scenario["strategy"];
  loanSource: Scenario["loan_source"];
  product?: string | null;
  termMonths?: number | null;
  loanAmount?: number;
  loanRate?: number | null;
  debtsPaidOff?: string | null;
  extraPaymentIds?: string | null;
};

export type NewExtraPayment = {
  caseId: string;
  householdId: string;
  type: ExtraPayment["type"];
  amount: number;
  startMonth: string;
  endMonth?: string | null;
  reason: string;
};

export type NewOverride = {
  caseId: string;
  householdId: string;
  entityType: CaseOverride["entity_type"];
  entityId: string;
  field: string;
  sourceValue: ParsedCell;
  overrideValue: ParsedCell;
  reason: string;
  reportedToBackend?: boolean;
};

export type NewCustomLoan = {
  caseId: string;
  householdId: string;
  lenderName: string;
  rate: number;
  termMonths: number;
  maxAmount: number;
  note?: string;
};

export type NewContact = {
  householdId: string;
  channel: ContactChannel;
  initiatedBy: ContactEvent["initiated_by"];
  planPresented: boolean;
  outcome: ContactOutcome;
  includesNewLoan?: boolean | null;
  caseId?: string | null;
  scenarioId?: string | null;
  insideCoolingOffOverrideReason?: string | null;
};

export type DataIssueReport = {
  caseId: string;
  householdId: string;
  entityType: string;
  entityId: string;
  field: string;
  reason: string;
};

type DemoActions = {
  setUser: (user: DemoUser) => void;
  resetDemo: () => void;
  startCase: (householdId: string) => string;
  addScenario: (input: NewScenario) => string;
  updateScenario: (scenarioId: string, patch: Partial<Omit<Scenario, "scenario_id" | "case_id">>) => void;
  removeScenario: (scenarioId: string) => void;
  addExtraPayment: (input: NewExtraPayment) => string;
  addOverride: (input: NewOverride) => string;
  addCustomLoan: (input: NewCustomLoan) => string;
  recommend: (
    scenarioId: string,
    ackReason?: string,
    meta?: { differs?: boolean; suggestedScenarioId?: string },
  ) => void;
  recordDecision: (caseId: string, outcome: Decision, contact: { channel: ContactChannel; reason?: string }) => boolean;
  logContact: (input: NewContact) => string;
  reportDataIssue: (input: DataIssueReport) => void;
};

export type DemoState = DemoData & { user: DemoUser } & DemoActions;

function cloneSeed(): DemoData {
  const caseOverrides = structuredClone(seedOverrides);
  return {
    cases: structuredClone(seedCases),
    caseHistory: structuredClone(seedHistory),
    scenarios: normalizeSeededScenarios(structuredClone(seedScenarios), caseOverrides),
    extraPayments: structuredClone(seedExtras),
    caseOverrides,
    customLoans: structuredClone(seedLoans),
    contacts: structuredClone(seedContacts),
    snapshots: [],
  };
}

/** Older browsers stored the seeded titles. Version 2 cleared snapshot schedules; version 3 cleans the titles. */
export function migrateDemoState(persisted: unknown, version: number): DemoState {
  const state = persisted as {
    snapshots?: FrozenSnapshot[];
    scenarios?: Scenario[];
    caseOverrides?: CaseOverride[];
  };
  if (version < 2 && state.snapshots) {
    state.snapshots = state.snapshots.map((row) => ({ ...row, schedule: [] }));
  }
  if (version < 3 && state.scenarios) {
    state.scenarios = normalizeSeededScenarios(state.scenarios, state.caseOverrides ?? []);
  }
  return persisted as DemoState;
}

function nextId(ids: readonly string[], prefix: string, width: number): string {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const value = Number(id.slice(prefix.length));
    if (Number.isFinite(value)) max = Math.max(max, value);
  }
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

function actorName(user: DemoUser): string {
  return user.role === "manager" ? "Manager" : user.name;
}

function withHistory(
  history: readonly CaseHistoryEvent[],
  caseId: string,
  events: readonly { event: string; refId: string | null; note?: string | null }[],
  by: string,
): CaseHistoryEvent[] {
  let seq = 0;
  for (const row of history) {
    if (row.case_id === caseId) seq = Math.max(seq, row.seq);
  }
  const added = events.map((item) => {
    seq += 1;
    return {
      case_id: caseId,
      seq,
      event: item.event,
      ref_id: item.refId,
      by,
      at: AS_OF,
      note: item.note ?? null,
    };
  });
  return [...history, ...added];
}

function planRisk(scenario: Scenario): PlanRisk {
  if (scenario.loan_source === "none") return "none";
  if (scenario.product?.startsWith("HELOAN")) return "secured";
  return "unsecured";
}

function suggestedScenarioId(data: DemoData, caseId: string): string {
  const scenarios = data.scenarios.filter((scenario) => scenario.case_id === caseId);
  const householdId = scenarios[0]?.household_id;
  if (!householdId) return "";
  const caseState = {
    overrides: data.caseOverrides.filter((row) => row.case_id === caseId),
    extraPayments: data.extraPayments.filter((row) => row.case_id === caseId),
    customLoans: data.customLoans.filter((row) => row.case_id === caseId),
  };
  const plans: PlanOption[] = scenarios.map((scenario) => {
    const result = runScenario(householdId, caseState, scenario);
    return {
      name: scenario.name,
      months: result.months,
      interest: result.totalInterest,
      contractual: result.contractualMonthly,
      risk: planRisk(scenario),
      schedule: result.schedule,
      payoffOrder: result.payoffOrder,
      payoffMonths: result.payoffMonths,
    };
  });
  const best = bestPlan(plans);
  return scenarios[plans.indexOf(best)]?.scenario_id ?? "";
}

function applySuggestion(data: DemoData, caseId: string): Case[] {
  const suggested = suggestedScenarioId(data, caseId);
  return data.cases.map((row) => {
    if (row.case_id !== caseId) return row;
    const recommended = row.recommended_scenario_id;
    return {
      ...row,
      tool_suggested_scenario_id: suggested,
      recommendation_differs_from_suggestion: recommended != null && recommended !== suggested,
      updated_at: AS_OF,
    };
  });
}

export const useDemoStore = create<DemoState>()(
  persist(
    (set, get) => ({
      user: defaultUser(),
      ...cloneSeed(),

      setUser: (user) => set({ user }),

      resetDemo: () => set(cloneSeed()),

      startCase: (householdId) => {
        const state = get();
        const existing = state.cases.find((row) => row.household_id === householdId);
        if (existing) return existing.case_id;
        const household = getHousehold(householdId);
        if (!household) throw new Error(`Unknown household ${householdId}`);
        const caseId = nextId(state.cases.map((row) => row.case_id), "C", 4);
        const advisor = state.user.role === "advisor" ? state.user.name : household.advisor;
        const branch = state.user.role === "advisor" ? state.user.branch : household.branch;
        const created: Case = {
          case_id: caseId,
          household_id: householdId,
          advisor,
          branch,
          status: "in_progress",
          created_at: AS_OF,
          updated_at: AS_OF,
          version: 1,
          recommended_scenario_id: null,
          recommended_payment_alert: null,
          payment_alert_acknowledged: false,
          tool_suggested_scenario_id: "",
          recommendation_differs_from_suggestion: false,
          decision: null,
          decision_at: null,
        };
        set({
          cases: [...state.cases, created],
          caseHistory: withHistory(
            state.caseHistory,
            caseId,
            [{ event: "case_created", refId: null }],
            actorName(state.user),
          ),
        });
        return caseId;
      },

      addScenario: (input) => {
        const state = get();
        const scenarioId = nextId(state.scenarios.map((row) => row.scenario_id), "S", 4);
        const created: Scenario = {
          scenario_id: scenarioId,
          case_id: input.caseId,
          household_id: input.householdId,
          name: input.name,
          strategy: input.strategy,
          loan_source: input.loanSource,
          product: input.product ?? null,
          term_months: input.termMonths ?? null,
          loan_amount: input.loanAmount ?? 0,
          loan_rate: input.loanRate ?? null,
          debts_paid_off: input.debtsPaidOff ?? null,
          extra_payment_ids: input.extraPaymentIds ?? null,
          created_by: actorName(state.user),
          is_recommended: false,
          advisor_reason: null,
        };
        const next: DemoData = {
          ...dataOf(state),
          scenarios: [...state.scenarios, created],
          caseHistory: withHistory(
            state.caseHistory,
            input.caseId,
            [{ event: "scenario_added", refId: scenarioId }],
            actorName(state.user),
          ),
        };
        next.cases = applySuggestion(next, input.caseId);
        set(next);
        return scenarioId;
      },

      updateScenario: (scenarioId, patch) => {
        const state = get();
        const current = state.scenarios.find((row) => row.scenario_id === scenarioId);
        if (!current) return;
        const next: DemoData = {
          ...dataOf(state),
          scenarios: state.scenarios.map((row) => (row.scenario_id === scenarioId ? { ...row, ...patch } : row)),
          caseHistory: withHistory(
            state.caseHistory,
            current.case_id,
            [{ event: "scenario_updated", refId: scenarioId }],
            actorName(state.user),
          ),
        };
        next.cases = applySuggestion(next, current.case_id);
        set(next);
      },

      removeScenario: (scenarioId) => {
        const state = get();
        const current = state.scenarios.find((row) => row.scenario_id === scenarioId);
        if (!current) return;
        const next: DemoData = {
          ...dataOf(state),
          scenarios: state.scenarios.filter((row) => row.scenario_id !== scenarioId),
          cases: state.cases.map((row) => {
            if (row.case_id !== current.case_id || row.recommended_scenario_id !== scenarioId) return row;
            return {
              ...row,
              recommended_scenario_id: null,
              recommended_payment_alert: null,
              payment_alert_acknowledged: false,
              recommendation_differs_from_suggestion: false,
              updated_at: AS_OF,
            };
          }),
          caseHistory: withHistory(
            state.caseHistory,
            current.case_id,
            [{ event: "scenario_removed", refId: scenarioId }],
            actorName(state.user),
          ),
        };
        next.cases = applySuggestion(next, current.case_id);
        set(next);
      },

      addExtraPayment: (input) => {
        const state = get();
        const extraId = nextId(state.extraPayments.map((row) => row.extra_id), "E", 4);
        const created: ExtraPayment = {
          extra_id: extraId,
          case_id: input.caseId,
          household_id: input.householdId,
          type: input.type,
          amount: input.amount,
          start_month: input.startMonth,
          end_month: input.endMonth ?? null,
          reason: input.reason,
        };
        const next: DemoData = {
          ...dataOf(state),
          extraPayments: [...state.extraPayments, created],
          caseHistory: withHistory(
            state.caseHistory,
            input.caseId,
            [{ event: "extra_payment_added", refId: extraId }],
            actorName(state.user),
          ),
        };
        next.cases = applySuggestion(next, input.caseId);
        set(next);
        return extraId;
      },

      addOverride: (input) => {
        const state = get();
        const prior = state.caseOverrides.find(
          (row) =>
            row.case_id === input.caseId &&
            row.entity_type === input.entityType &&
            row.entity_id === input.entityId &&
            row.field === input.field,
        );
        const overrideId = nextId(state.caseOverrides.map((row) => row.override_id), "O", 4);
        const created: CaseOverride = {
          override_id: overrideId,
          case_id: input.caseId,
          household_id: input.householdId,
          entity_type: input.entityType,
          entity_id: input.entityId,
          field: input.field,
          source_value: prior ? prior.source_value : input.sourceValue,
          override_value: input.overrideValue,
          reason: input.reason,
          reported_to_backend: input.reportedToBackend ?? false,
          changed_by: actorName(state.user),
          changed_at: AS_OF,
        };
        const next: DemoData = {
          ...dataOf(state),
          caseOverrides: [...state.caseOverrides, created],
          cases: state.cases.map((row) =>
            row.case_id === input.caseId ? { ...row, version: row.version + 1, updated_at: AS_OF } : row,
          ),
          caseHistory: withHistory(
            state.caseHistory,
            input.caseId,
            [{ event: "override", refId: overrideId }],
            actorName(state.user),
          ),
        };
        next.cases = applySuggestion(next, input.caseId);
        set(next);
        return overrideId;
      },

      addCustomLoan: (input) => {
        const state = get();
        const loanId = nextId(state.customLoans.map((row) => row.custom_loan_id), "L", 3);
        const created: CustomLoan = {
          custom_loan_id: loanId,
          case_id: input.caseId,
          household_id: input.householdId,
          lender_name: input.lenderName,
          rate: input.rate,
          term_months: input.termMonths,
          max_amount: input.maxAmount,
          note: input.note ?? "",
        };
        set({
          customLoans: [...state.customLoans, created],
          caseHistory: withHistory(
            state.caseHistory,
            input.caseId,
            [{ event: "custom_loan_added", refId: loanId }],
            actorName(state.user),
          ),
        });
        return loanId;
      },

      recommend: (scenarioId, ackReason, meta) => {
        const state = get();
        const scenario = state.scenarios.find((row) => row.scenario_id === scenarioId);
        if (!scenario) return;
        const caseState = {
          overrides: state.caseOverrides.filter((row) => row.case_id === scenario.case_id),
          extraPayments: state.extraPayments.filter((row) => row.case_id === scenario.case_id),
          customLoans: state.customLoans.filter((row) => row.case_id === scenario.case_id),
        };
        const result = runScenario(scenario.household_id, caseState, scenario);
        const alert = result.paymentAlert;
        const note = ackReason?.trim() ? ackReason.trim() : null;
        const acknowledged = alert !== "none" && note != null;
        const events: { event: string; refId: string | null; note: string | null }[] = [];
        if (acknowledged) events.push({ event: "payment_alert_acknowledged", refId: scenarioId, note });
        events.push({ event: "recommended", refId: scenarioId, note });
        const next: DemoData = {
          ...dataOf(state),
          scenarios: state.scenarios.map((row) => {
            if (row.case_id !== scenario.case_id) return row;
            if (row.scenario_id !== scenarioId) return { ...row, is_recommended: false };
            return {
              ...row,
              is_recommended: true,
              advisor_reason: ackReason ?? row.advisor_reason,
            };
          }),
          caseHistory: withHistory(state.caseHistory, scenario.case_id, events, actorName(state.user)),
        };
        const suggested =
          meta?.suggestedScenarioId ?? suggestedScenarioId(next, scenario.case_id);
        const differs = meta?.differs ?? (suggested !== "" && suggested !== scenarioId);
        next.cases = state.cases.map((row) => {
          if (row.case_id !== scenario.case_id) return row;
          return {
            ...row,
            recommended_scenario_id: scenarioId,
            recommended_payment_alert: alert,
            payment_alert_acknowledged: acknowledged,
            tool_suggested_scenario_id: suggested,
            recommendation_differs_from_suggestion: differs,
            updated_at: AS_OF,
          };
        });
        set(next);
      },

      recordDecision: (caseId, outcome, contact) => {
        const state = get();
        const current = state.cases.find((row) => row.case_id === caseId);
        const scenario = state.scenarios.find((row) => row.scenario_id === current?.recommended_scenario_id);
        if (!current || !scenario) return false;
        const planned = planDecision({
          caseRow: current,
          scenario,
          contacts: state.contacts,
          caseState: {
            overrides: state.caseOverrides,
            extraPayments: state.extraPayments,
            customLoans: state.customLoans,
          },
          outcome,
          channel: contact.channel,
          reason: contact.reason ?? "",
          advisor: actorName(state.user),
          contactId: nextId(state.contacts.map((row) => row.contact_id), "K", 5),
          snapshotId: nextId((state.snapshots ?? []).map((row) => row.snapshot_id), "N", 4),
        });
        if (!planned) return false;
        set({
          cases: state.cases.map((row) =>
            row.case_id === caseId
              ? { ...row, status: outcome, decision: outcome, decision_at: AS_OF, updated_at: AS_OF }
              : row,
          ),
          contacts: [...state.contacts, planned.contact],
          caseHistory: withHistory(state.caseHistory, caseId, planned.events, actorName(state.user)),
          snapshots: planned.snapshot ? [...(state.snapshots ?? []), planned.snapshot] : (state.snapshots ?? []),
        });
        return true;
      },

      logContact: (input) => {
        const state = get();
        const contactId = nextId(state.contacts.map((row) => row.contact_id), "K", 5);
        const created: ContactEvent = {
          contact_id: contactId,
          household_id: input.householdId,
          advisor: state.user.role === "advisor" ? state.user.name : actorName(state.user),
          contacted_at: AS_OF,
          channel: input.channel,
          initiated_by: input.initiatedBy,
          plan_presented: input.planPresented,
          outcome: input.outcome,
          includes_new_loan: input.includesNewLoan ?? null,
          case_id: input.caseId ?? null,
          scenario_id: input.scenarioId ?? null,
          inside_cooling_off_override_reason: input.insideCoolingOffOverrideReason ?? null,
        };
        const history = input.caseId
          ? withHistory(
              state.caseHistory,
              input.caseId,
              [{ event: "contact_logged", refId: contactId }],
              actorName(state.user),
            )
          : state.caseHistory;
        set({ contacts: [...state.contacts, created], caseHistory: history });
        return contactId;
      },

      reportDataIssue: (input) => {
        const state = get();
        if (!state.cases.some((row) => row.case_id === input.caseId)) return;
        const refId = `${input.entityType}:${input.entityId}:${input.field}${input.reason ? ` (${input.reason})` : ""}`;
        set({
          caseHistory: withHistory(
            state.caseHistory,
            input.caseId,
            [{ event: "data_issue_reported", refId }],
            actorName(state.user),
          ),
        });
      },
    }),
    {
      name: "debt-free-v1",
      version: 3,
      storage: createJSONStorage(demoStorage),
      skipHydration: true,
      migrate: migrateDemoState,
      partialize: (state) => ({
        user: state.user,
        cases: state.cases,
        caseHistory: state.caseHistory,
        scenarios: state.scenarios,
        extraPayments: state.extraPayments,
        caseOverrides: state.caseOverrides,
        customLoans: state.customLoans,
        contacts: state.contacts,
        snapshots: (state.snapshots ?? []).map((row) => ({ ...row, schedule: [] })),
      }),
    },
  ),
);

/** Browser writes wait 300ms and store inputs only. Node tests write immediately. */
function demoStorage(): Storage {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { key: string; value: string } | null = null;
  const flush = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    localStorage.setItem(pending.key, pending.value);
    pending = null;
  };
  const immediate = typeof window === "undefined";
  if (!immediate) window.addEventListener("pagehide", flush);
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => {
      if (immediate) {
        localStorage.setItem(key, value);
        return;
      }
      pending = { key, value };
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(flush, 300);
    },
    removeItem: (key) => {
      if (pending?.key === key) pending = null;
      localStorage.removeItem(key);
    },
    clear: () => localStorage.clear(),
    key: (index) => localStorage.key(index),
    get length() {
      return localStorage.length;
    },
  };
}

function dataOf(state: DemoState): DemoData {
  return {
    cases: state.cases,
    caseHistory: state.caseHistory,
    scenarios: state.scenarios,
    extraPayments: state.extraPayments,
    caseOverrides: state.caseOverrides,
    customLoans: state.customLoans,
    contacts: state.contacts,
    snapshots: state.snapshots ?? [],
  };
}
