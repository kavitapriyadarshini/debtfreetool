import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatMonths, formatPercent } from "../format";

describe("format", () => {
  it("formats money, months, dates and percents", () => {
    expect(formatMoney(12345)).toBe("$12,345");
    expect(formatMonths(134)).toBe("11 years 2 months");
    expect(formatMonths(1)).toBe("1 month");
    expect(formatMonths(12)).toBe("1 year");
    expect(formatMonths(null)).toBe("Never");
    expect(formatDate("2027-09-04")).toBe("4 Sep 2027");
    expect(formatDate("2026-11-14")).toBe("14 Nov 2026");
    expect(formatPercent(191.2)).toBe("+191%");
    expect(formatPercent(-17.3)).toBe("-17%");
    expect(formatPercent(0)).toBe("0%");
  });
});
