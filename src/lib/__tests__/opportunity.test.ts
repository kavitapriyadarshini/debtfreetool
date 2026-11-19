import { describe, expect, it } from "vitest";
import { caseOverrides, cases, contacts, households } from "../data";
import { formatMoney, formatPercent, paymentAlertText, NOT_COMPARABLE } from "../format";
import {
  filterOpportunities,
  interestSavedLabel,
  listOpportunities,
  monthsSavedLabel,
  sortOpportunities,
  type OpportunityRow,
} from "../opportunity";

function book(advisor: string): OpportunityRow[] {
  return listOpportunities(
    households.filter((household) => household.advisor === advisor),
    contacts,
    cases,
    caseOverrides,
  );
}

describe("opportunity list", () => {
  it("keeps H01 waiting until 4 Sep 2027 and ranks ready households by months saved", () => {
    const rows = book("Pamela Wilson");
    const h01 = rows.find((row) => row.householdId === "H01");
    expect(h01?.outreach).toBe("waiting");
    expect(h01?.readyDate).toBe("2027-09-04");

    const ready = sortOpportunities(
      rows.filter((row) => row.outreach === "ready"),
      "months",
    );
    const again = sortOpportunities(ready, "months").map((row) => row.householdId);
    expect(ready.map((row) => row.householdId)).toEqual(again);
    const firstAction = ready.findIndex((row) => row.noAction);
    if (firstAction >= 0) {
      expect(ready.slice(0, firstAction).every((row) => !row.noAction)).toBe(true);
      expect(ready.slice(firstAction).every((row) => row.noAction)).toBe(true);
    }
  });

  it("shows H11's red alert and H04's FastApp reason on the waiting tab", () => {
    const rows = book("Tom Brennan");
    const h11 = rows.find((row) => row.householdId === "H11");
    expect(h11?.outreach).toBe("waiting");
    expect(h11?.alert).toBe("red");
    expect(h11?.planType).toBe("FastApp");
    expect(formatPercent(h11?.paymentChangePct ?? 0)).toBe("+191%");
    expect(formatMoney(h11?.currentMonthly ?? 0)).toBe("$1,562");
    expect(formatMoney(h11?.bestMonthly ?? 0)).toBe("$4,548");
    if (!h11) throw new Error("H11 is missing from Tom Brennan's book");
    expect(paymentAlertText(h11.currentMonthly, h11.bestMonthly, h11.paymentChangePct)).toBe(
      "Monthly payment $1,562 → $4,548 (+191%)",
    );

    const h04 = rows.find((row) => row.householdId === "H04");
    expect(h04?.outreach).toBe("waiting");
    expect(h04?.noOfferReason).toBe(
      "Pre-approved for FastApp, but $8,600 of cards is below the $10,000 minimum.",
    );
  });

  it("shows H55 from the case, with the nightly figure kept for the tooltip", () => {
    const rows = listOpportunities(households, contacts, cases, caseOverrides);
    const h55 = rows.find((row) => row.householdId === "H55");
    expect(h55?.updatedInCase).toBe(true);
    expect(h55?.monthsSaved).toBe(11);
    expect(h55?.interestSaved).toBe(3304);
    if (!h55) throw new Error("H55 is missing from the opportunity list");
    expect(monthsSavedLabel(h55)).toBe("11 months");
    expect(interestSavedLabel(h55)).toBe("$3,304");
    expect(h55?.nightlyMonthsLabel).toBe(NOT_COMPARABLE);
    expect(h55?.nightlyInterestLabel).toBe(NOT_COMPARABLE);
    expect(h55?.flags).not.toContain("payment_below_interest");
    expect(`${monthsSavedLabel(h55)} ${interestSavedLabel(h55)}`).not.toMatch(/Never →|Not comparable|from never/);

    const ranked = sortOpportunities(book("Pamela Wilson"), "months");
    const firstComparable = ranked.findIndex((row) => row.monthsSaved !== "from never" && !row.noAction);
    if (firstComparable > 0) {
      expect(ranked.slice(0, firstComparable).every((row) => row.monthsSaved === "from never")).toBe(true);
    }
    expect(ranked.find((row) => row.householdId === "H55")?.monthsSaved).toBe(11);
  });

  it("ranks H12 last among Elena Duarte's waiting households and says no action needed", () => {
    const waiting = sortOpportunities(
      book("Elena Duarte").filter((row) => row.outreach === "waiting"),
      "months",
    );
    const h12 = waiting.find((row) => row.householdId === "H12");
    if (!h12) throw new Error("H12 is missing from Elena Duarte's waiting list");
    expect(monthsSavedLabel(h12)).toBe("No action needed");
    const index = waiting.findIndex((row) => row.householdId === "H12");
    expect(waiting.slice(index + 1).every((row) => row.noAction)).toBe(true);
  });

  it("combines filters and treats a household that was never contacted as the oldest", () => {
    const rows = book("Tom Brennan");
    const filtered = filterOpportunities(rows, {
      product: "FastApp",
      flags: "yes",
      caseStatus: "any",
      minMonths: 50,
    });
    expect(filtered.some((row) => row.householdId === "H11")).toBe(false);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((row) => row.products.includes("FastApp") && row.flags.length > 0)).toBe(true);

    const sample = rows[0];
    if (!sample) throw new Error("Tom Brennan's book is empty");
    const sorted = sortOpportunities(
      [
        { ...sample, householdId: "H2", lastContacted: "2026-01-01" },
        { ...sample, householdId: "H10", lastContacted: null },
        { ...sample, householdId: "H3", lastContacted: "2026-06-01" },
      ],
      "last_contacted",
    );
    expect(sorted.map((row) => row.householdId)).toEqual(["H10", "H2", "H3"]);
  });

  it("flags H03 and H11 when nobody has a FICO score", () => {
    const rows = listOpportunities(households, contacts, cases, caseOverrides);
    expect(rows.find((row) => row.householdId === "H03")?.flags).toContain("no_fico_any_member");
    expect(rows.find((row) => row.householdId === "H11")?.flags).not.toContain("no_fico_any_member");
    expect(rows.find((row) => row.householdId === "H11")?.flags).not.toContain("possible_duplicate");
  });
});
