import { describe, expect, it } from "vitest";
import { keepLastGood } from "../keep-last";

describe("keepLastGood", () => {
  it("keeps the last good result and marks it stale when the next attempt throws", () => {
    const first = keepLastGood(null, () => ({ months: 129 }));
    expect(first).toEqual({ value: { months: 129 }, stale: false, failed: false });

    const again = keepLastGood(first.value, () => {
      throw new Error("recalculation failed");
    });
    expect(again).toEqual({ value: { months: 129 }, stale: true, failed: true });
  });

  it("has nothing to keep when the first attempt throws", () => {
    const failed = keepLastGood<number>(null, () => {
      throw new Error("data won't load");
    });
    expect(failed).toEqual({ value: null, stale: false, failed: true });
  });
});
