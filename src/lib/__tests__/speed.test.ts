import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { compareFor } from "../compare";
import { debts, households } from "../data";
import { presentFor } from "../present";
import { workspaceFor } from "../workspace";

const empty = { overrides: [], extraPayments: [], customLoans: [] };

function largestHousehold(): string {
  const counts = new Map<string, number>();
  for (const debt of debts) {
    counts.set(debt.household_id, (counts.get(debt.household_id) ?? 0) + 1);
  }
  let id = households[0]?.household_id ?? "";
  let most = -1;
  for (const household of households) {
    const count = counts.get(household.household_id) ?? 0;
    if (count > most) {
      most = count;
      id = household.household_id;
    }
  }
  return id;
}

describe("recalculation speed", () => {
  it("rebuilds S3, S4, and S5 for the largest household in under a second each", () => {
    const id = largestHousehold();
    const workspaceStarted = performance.now();
    const workspace = workspaceFor(id, null, empty, []);
    const workspaceMs = performance.now() - workspaceStarted;

    const compareStarted = performance.now();
    const compared = compareFor(id, null, empty, [], ["current", "avalanche", "snowball"]);
    const compareMs = performance.now() - compareStarted;

    const presentStarted = performance.now();
    const presented = presentFor(id, null, empty, [], "");
    const presentMs = performance.now() - presentStarted;

    expect(workspace).not.toBeNull();
    expect(compared?.columns.length).toBeGreaterThan(0);
    expect(presented).not.toBeNull();
    expect(workspaceMs).toBeLessThan(1000);
    expect(compareMs).toBeLessThan(1000);
    expect(presentMs).toBeLessThan(1000);
  });
});
