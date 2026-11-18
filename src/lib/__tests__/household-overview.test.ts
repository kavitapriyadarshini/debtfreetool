import { describe, expect, it } from "vitest";
import { caseHistory, caseOverrides, cases, contacts, membersOf } from "../data";
import { householdWithCase } from "../engine/scenario";
import { buildHouseholdOverview, type HouseholdOverview } from "../household-overview";

function overview(id: string): HouseholdOverview {
  const caseRecord = [...cases].reverse().find((row) => row.household_id === id);
  const view = buildHouseholdOverview({
    householdId: id,
    caseId: caseRecord?.case_id ?? null,
    overrides: caseOverrides,
    contacts,
    history: caseHistory,
  });
  if (!view) throw new Error(`Missing ${id}`);
  return view;
}

function debt(view: HouseholdOverview, debtId: string) {
  const found = view.debts.find((row) => row.debtId === debtId);
  if (!found) throw new Error(`Missing ${debtId}`);
  return found;
}

describe("household overview", () => {
  it("shows whose score is used when one member has no FICO", () => {
    const view = overview("H01");
    expect(view.fico.text).toBe("720");
    expect(view.fico.whose).toBe("Using Raj Patel's score");
    expect(view.fico.flag).toBeNull();
    expect(view.waiting).toContain("Ready from 4 Sep 2027");
    expect(view.waiting).toContain("Agreed, with a new loan");
  });

  it("uses 740, estimated, when nobody has a FICO", () => {
    const view = overview("H03");
    expect(view.fico.text).toBe("740, estimated");
    expect(view.fico.flag).toBe("No FICO score on file");
  });

  it("keeps H07's reverse mortgage out and shows the corrected card payment", () => {
    const view = overview("H07");
    const reverse = debt(view, "H07-D01");
    expect(reverse.grey).toBe(true);
    expect(reverse.rowNotes.map((note) => note.text)).toContain("not included in plans");

    const card = debt(view, "H07-D02");
    expect(card.grey).toBe(false);
    expect(card.payment.text).toBe("$595");
    expect(card.payment.override).toMatchObject({
      original: "$250",
      next: "$595",
      by: "Pamela Wilson",
      at: "2 Nov 2026",
    });
    expect(card.payment.notes.map((note) => note.text)).toContain("Never pays off at the original payment");
  });

  it("shows H08's confirmed rate and the income warning", () => {
    const view = overview("H08");
    const card = debt(view, "H08-D02");
    expect(card.rate.text).toBe("22.99%");
    expect(card.rate.override).toMatchObject({ original: "0%", next: "22.99%", by: "Tom Brennan" });
    expect(card.rate.notes).toEqual([]);
    expect(view.income.text).toBe("$18,000");
    expect(view.income.note).toBe("Income looks like a monthly amount entered as annual");
  });

  it("keeps H09's 1998 value date stale after the value edit", () => {
    const view = overview("H09");
    const home = view.properties.find((property) => property.propertyId === "P09");
    expect(home?.stale).toBe(true);
    expect(home?.valueDate).toBe("30 Jun 1998");
    expect(home?.value.text).toBe("$271,000");
    expect(home?.value.override).toMatchObject({ original: "$95,000", next: "$271,000" });
    expect(home?.value.notes.map((note) => note.text)).toContain("Property value is from before 2024");
  });

  it("marks H11's duplicate cards, the excluded copy, and the case FICO", () => {
    const view = overview("H11");
    expect(view.fico.text).toBe("698");
    expect(view.fico.whose).toBe("Using Andre Moore's score");
    expect(view.fico.flag).toContain("740, estimated");
    expect(view.fico.overrides[0]).toMatchObject({ original: "No score", next: "698", by: "Tom Brennan" });
    expect(view.waiting).toContain("Ready from 13 Jan 2027");

    const first = debt(view, "H11-D01");
    const second = debt(view, "H11-D02");
    expect(first.rowNotes.map((note) => note.text)).toContain("possible duplicate");
    expect(second.rowNotes.map((note) => note.text)).toContain("possible duplicate");
    expect(second.grey).toBe(true);
    expect(second.rowNotes.map((note) => note.text)).toContain("not included in plans");
    expect(second.exclude?.override).toMatchObject({ original: "Included", next: "Excluded" });
    expect(second.exclude?.edit).toBeNull();
    expect(first.exclude?.edit?.field).toBe("excluded");

    const planned = householdWithCase("H11", {
      overrides: caseOverrides.filter((row) => row.case_id === "C0005"),
      extraPayments: [],
      customLoans: [],
    });
    expect(planned.debts.map((row) => row.debt_id)).not.toContain("H11-D02");
    expect(membersOf("H11").find((member) => member.member_id === "H11-M1")?.fico).toBeNull();
  });

  it("shows H15's mortgage linked for the case and H16's comfort zone", () => {
    const linked = overview("H15");
    const mortgage = debt(linked, "H15-D01");
    expect(mortgage.link?.text).toBe("301 Pine Valley Rd, Raleigh, NC");
    expect(mortgage.link?.override).toMatchObject({
      original: "Not linked",
      next: "301 Pine Valley Rd, Raleigh, NC",
      by: "Elena Duarte",
    });
    expect(mortgage.link?.notes).toEqual([]);

    const zone = overview("H16");
    expect(zone.comfort.text).toBe("Zone 2");
    expect(zone.comfort.override).toMatchObject({ original: "Not set", next: "Zone 2" });
    expect(zone.comfort.notes.map((note) => note.text)).toContain(
      "Comfort zone was missing, so FastApp was not available",
    );
  });

  it("shows the source warnings before a case edits them", () => {
    const card = buildHouseholdOverview({
      householdId: "H07",
      caseId: null,
      overrides: [],
      contacts: [],
      history: [],
    });
    const slate = card?.debts.find((row) => row.debtId === "H07-D02");
    expect(slate?.payment.text).toBe("$250");
    expect(slate?.payment.notes).toEqual([{ text: "Never pays off", tone: "flag" }]);

    const rate = buildHouseholdOverview({
      householdId: "H08",
      caseId: null,
      overrides: [],
      contacts: [],
      history: [],
    });
    const wells = rate?.debts.find((row) => row.debtId === "H08-D02");
    expect(wells?.rate.notes).toEqual([{ text: "Confirm or edit the rate", tone: "flag" }]);

    const unlinked = buildHouseholdOverview({
      householdId: "H15",
      caseId: null,
      overrides: [],
      contacts: [],
      history: [],
    });
    const mortgage = unlinked?.debts.find((row) => row.debtId === "H15-D01");
    expect(mortgage?.link?.text).toBe("Not linked");
    expect(mortgage?.link?.notes).toEqual([{ text: "Link this mortgage to a property", tone: "flag" }]);

    const missing = overview("H10");
    expect(missing.income.text).toBe("Missing");
    expect(missing.income.note).toBe("Income is missing");
    const student = missing.debts.find((row) => row.name === "Navient Student Loan");
    expect(student?.grey).toBe(true);
    expect(student?.rowNotes.map((note) => note.text)).toContain("not included in plans");
  });

  it("returns nothing for an unknown household", () => {
    expect(
      buildHouseholdOverview({
        householdId: "H9999",
        caseId: null,
        overrides: [],
        contacts: [],
        history: [],
      }),
    ).toBeNull();
  });
});
