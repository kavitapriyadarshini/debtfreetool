import { describe, expect, it } from "vitest";
import { cases, contacts, households } from "../data";
import { formatMoney, formatPercent, NOT_COMPARABLE } from "../format";
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

    const h04 = rows.find((row) => row.householdId === "H04");
    expect(h04?.outreach).toBe("waiting");
    expect(h04?.noOfferReason).toBe(
      "Pre-approved for FastApp, but $8,600 of cards is below the $10,000 minimum.",
    );
  });

  it("shows H07 as never to the best plan's time, with interest that is not comparable", () => {
    const rows = sortOpportunities(book("Pamela Wilson"), "months");
    const h07 = rows.find((row) => row.householdId === "H07");
    expect(monthsSavedLabel(h07!)).toBe("Never → 8 yrs 10 mos");
    expect(interestSavedLabel(h07!)).toBe(NOT_COMPARABLE);
    expect(formatMoney(h07?.bestPlanInterest ?? 0)).toBe("$33,595");
    expect(monthsSavedLabel(h07!)).not.toMatch(/from never|n\/a|—/i);
    const firstComparable = rows.findIndex((row) => row.monthsSaved !== "from never" && !row.noAction);
    expect(rows.slice(0, firstComparable).every((row) => row.monthsSaved === "from never")).toBe(true);
    expect(rows.findIndex((row) => row.householdId === "H07")).toBeLessThan(firstComparable);
  });

  it("ranks H12 last among Elena Duarte's waiting households and says no action needed", () => {
    const waiting = sortOpportunities(
      book("Elena Duarte").filter((row) => row.outreach === "waiting"),
      "months",
    );
    const h12 = waiting.find((row) => row.householdId === "H12");
    expect(monthsSavedLabel(h12!)).toBe("No action needed");
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
    expect(filtered.some((row) => row.householdId === "H11")).toBe(true);
    expect(filtered.every((row) => row.products.includes("FastApp") && row.flags.length > 0)).toBe(true);

    const sorted = sortOpportunities(
      [
        { ...rows[0]!, householdId: "H2", lastContacted: "2026-01-01" },
        { ...rows[0]!, householdId: "H10", lastContacted: null },
        { ...rows[0]!, householdId: "H3", lastContacted: "2026-06-01" },
      ],
      "last_contacted",
    );
    expect(sorted.map((row) => row.householdId)).toEqual(["H10", "H2", "H3"]);
  });

  it("flags H03 and H11 when nobody has a FICO score", () => {
    const rows = listOpportunities(households, contacts, cases);
    expect(rows.find((row) => row.householdId === "H03")?.flags).toContain("no_fico_any_member");
    expect(rows.find((row) => row.householdId === "H11")?.flags).toContain("no_fico_any_member");
  });
});
