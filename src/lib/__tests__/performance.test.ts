import { performance } from "node:perf_hooks";
import { beforeEach, describe, expect, it } from "vitest";
import { cases, caseOverrides, customLoans, extraPayments, scenarios } from "../data";
import { resetScenarioCache, runScenario, scenarioComputeCount } from "../engine/scenario";
import { runPipeline } from "../engine/pipeline";

const caseState = { overrides: caseOverrides, extraPayments, customLoans };

describe("recalculation after repeated edits", () => {
  beforeEach(() => {
    resetScenarioCache();
  });

  it("recalculates each of 50 H01 scenario edits in under 100ms and skips scenarios that did not change", () => {
    const h01 = cases.find((row) => row.household_id === "H01");
    const originals = scenarios.filter((row) => row.case_id === h01?.case_id);
    expect(originals.length).toBeGreaterThan(1);
    const [edited, ...rest] = originals;

    for (const row of originals) runScenario("H01", caseState, row);
    const afterWarm = scenarioComputeCount();

    const times: number[] = [];
    for (let edit = 0; edit < 50; edit += 1) {
      const next = { ...edited!, loan_amount: 20_000 + edit * 500 };
      const started = performance.now();
      runScenario("H01", caseState, next);
      for (const row of rest) runScenario("H01", caseState, row);
      times.push(performance.now() - started);
    }

    expect(Math.max(...times)).toBeLessThan(100);
    expect(scenarioComputeCount() - afterWarm).toBe(50);
  });

  it("runs the nightly pipeline once and reuses that result", () => {
    const first = performance.now();
    const pipeline = runPipeline();
    const firstMs = performance.now() - first;
    const second = performance.now();
    const again = runPipeline();
    const secondMs = performance.now() - second;
    expect(again).toBe(pipeline);
    expect(pipeline.results).toHaveLength(299);
    expect(firstMs).toBeLessThan(1000);
    expect(secondMs).toBeLessThan(5);
  });
});

describe("persisted demo state", () => {
  it("writes cases and scenarios, and stores an empty schedule on a snapshot", async () => {
    const memory = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memory.set(key, value);
        },
        removeItem: (key: string) => {
          memory.delete(key);
        },
      },
    });
    const { useDemoStore } = await import("../store");
    const store = useDemoStore.getState();
    store.resetDemo();
    store.setUser({ role: "advisor", name: "Pamela Wilson", branch: "North Branch" });
    const caseId = store.startCase("H01");
    const scenarioId = store.addScenario({
      caseId,
      householdId: "H01",
      name: "Speed check",
      strategy: "avalanche",
      loanSource: "none",
    });
    store.recommend(scenarioId);
    expect(store.recordDecision(caseId, "agreed", { channel: "servicing_call" })).toBe(true);
    const saved = memory.get("debt-free-v1");
    expect(saved).toBeTruthy();
    const parsed = JSON.parse(saved!) as {
      version: number;
      state: { snapshots: { schedule: unknown[]; years: unknown[] }[]; scenarios: unknown[]; cases: unknown[] };
    };
    expect(parsed.version).toBe(2);
    expect(parsed.state.cases.length).toBeGreaterThan(0);
    expect(parsed.state.scenarios.length).toBeGreaterThan(0);
    expect(parsed.state.snapshots.every((row) => row.schedule.length === 0)).toBe(true);
    expect(parsed.state.snapshots.every((row) => Array.isArray(row.years) && row.years.length > 0)).toBe(true);
    const live = useDemoStore.getState().snapshots.find((row) => row.household_id === "H01");
    expect(live?.schedule.length).toBeGreaterThan(0);
    store.resetDemo();
  });
});
