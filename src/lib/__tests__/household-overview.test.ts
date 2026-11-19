import { describe, expect, it } from "vitest";
import { AS_OF } from "../config";
import { caseHistory, caseOverrides, cases, contacts, customLoans, debts, extraPayments, membersOf, scenarios } from "../data";
import { formatMoney } from "../format";
import { householdWithCase } from "../engine/scenario";
import { buildHouseholdOverview, editedValueLine, type HouseholdOverview } from "../household-overview";
import { workspaceFor } from "../workspace";
import type { CaseOverride } from "../types";

function overview(id: string): HouseholdOverview {
  const caseRecord = [...cases].reverse().find((row) => row.household_id === id);
  const view = buildHouseholdOverview({
    householdId: id,
    caseId: caseRecord?.case_id ?? null,
    overrides: caseOverrides,
    contacts,
    history: caseHistory,
    recommendedScenarioId: caseRecord?.recommended_scenario_id ?? null,
    scenarios,
    extraPayments,
    customLoans,
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
    expect(view.outreach).toBe("Waiting");
    expect(view.readyDate).toBe("4 Sep 2027");
    expect(view.planInPlay).toEqual({
      label: "Recommended",
      months: "9 years 6 months",
      interest: "$107,710",
      note: null,
    });
  });

  it("uses the nightly best when no plan is marked, and not comparable when today never finishes", () => {
    const nightly = buildHouseholdOverview({
      householdId: "H01",
      caseId: null,
      overrides: [],
      contacts: [],
      history: [],
    });
    expect(nightly?.outreach).toBe("Ready to contact");
    expect(nightly?.readyDate).toBeNull();
    expect(nightly?.planInPlay).toEqual({
      label: "Pipeline recommended",
      months: "9 years 3 months",
      interest: "$102,847",
      note: null,
    });
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
    const cardEdit = card.payment.override;
    if (!cardEdit) throw new Error("H07 card payment edit is missing");
    expect(editedValueLine(card.payment.text, cardEdit)).toBe(
      "$595 (was $250) · Household confirmed their actual monthly payment · Pamela Wilson, 2 Nov 2026",
    );
    expect(card.payment.notes.map((note) => note.text)).toEqual(["Resolved in this case"]);
    expect(card.payment.notes.map((note) => note.text)).not.toContain("Never pays off at the original payment");
    expect(view.planInPlay).toEqual({
      label: "Recommended",
      months: "1 year 6 months",
      interest: "$577",
      note: null,
    });
  });

  it("shows H08's confirmed rate and the income warning", () => {
    const view = overview("H08");
    const card = debt(view, "H08-D02");
    expect(card.rate.text).toBe("22.99%");
    expect(card.rate.override).toMatchObject({ original: "0%", next: "22.99%", by: "Tom Brennan" });
    expect(card.rate.notes.map((note) => note.text)).toEqual(["Resolved in this case"]);
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
    expect(view.fico.flag).toBeNull();
    expect(view.fico.resolved).toBe("Resolved in this case");
    expect(view.fico.overrides[0]).toMatchObject({ original: "No score", next: "698", by: "Tom Brennan" });
    expect(view.waiting).toContain("Ready from 13 Jan 2027");

    const first = debt(view, "H11-D01");
    const second = debt(view, "H11-D02");
    expect(first.rowNotes.map((note) => note.text)).not.toContain("possible duplicate");
    expect(second.rowNotes.map((note) => note.text)).not.toContain("possible duplicate");
    expect(second.exclude?.notes.map((note) => note.text)).toEqual(["Resolved in this case"]);
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
    expect(mortgage.link?.notes.map((note) => note.text)).toEqual(["Resolved in this case"]);

    const zone = overview("H16");
    expect(zone.comfort.text).toBe("Zone 2");
    expect(zone.comfort.override).toMatchObject({ original: "Not set", next: "Zone 2" });
    expect(zone.comfort.notes.map((note) => note.text)).toEqual(["Resolved in this case"]);
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
    expect(card?.planInPlay).toEqual({
      label: "Pipeline recommended",
      months: null,
      interest: null,
      note: "Today's payments never clear these debts. With the best plan: debt free in 8 years 10 months.",
    });

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

  it("shows H55's edited Amex payment with the original, the reason, and the resolved flag", () => {
    const view = overview("H55");
    const amex = debt(view, "H55-D01");
    expect(amex.payment.override).not.toBeNull();
    const amexEdit = amex.payment.override;
    if (!amexEdit) throw new Error("H55 Amex payment edit is missing");
    expect(editedValueLine(amex.payment.text, amexEdit)).toBe(
      "$827 (was $307) · Household confirmed their actual monthly payment · Pamela Wilson, 21 Oct 2026",
    );
    expect(amex.payment.notes.map((note) => note.text)).toEqual(["Resolved in this case"]);
    expect(amex.payment.notes.map((note) => note.text)).not.toContain("Never pays off at the original payment");
  });

  it("edits a debt balance on the case, shows the original, and leaves the source alone", () => {
    const view = overview("H55");
    const amex = debt(view, "H55-D01");
    expect(amex.name).toBe("Amex Gold");
    expect(amex.balance.edit?.label).toBe("Amex Gold balance");
    expect(amex.balance.report?.label).toBe("Amex Gold balance");
    expect(amex.rate.edit?.label).toBe("Amex Gold interest rate");
    expect(amex.payment.edit?.label).toBe("Amex Gold monthly payment");
    for (const row of view.debts) {
      expect(row.balance.edit, row.name).not.toBeNull();
      expect(row.balance.report, row.name).not.toBeNull();
      expect(row.rate.edit, row.name).not.toBeNull();
      expect(row.payment.edit, row.name).not.toBeNull();
    }
    expect(view.comfort.edit?.label).toBe("Comfort zone");
    expect(view.members.every((member) => member.fico.edit && member.fico.report)).toBe(true);
    expect(view.properties.every((property) => property.value.edit && property.value.report)).toBe(true);
    const home = overview("H01");
    const mortgages = home.debts.filter((row) => row.link);
    expect(mortgages.length).toBeGreaterThan(0);
    expect(mortgages.every((row) => row.link?.edit && row.link.report)).toBe(true);

    const source = debts.find((row) => row.debt_id === "H01-D01");
    const caseRecord = [...cases].reverse().find((row) => row.household_id === "H01");
    if (!source) throw new Error("H01-D01 is missing from the source debts");
    if (!caseRecord) throw new Error("H01 has no case");
    const sourceBalance = source.balance;
    const override: CaseOverride = {
      override_id: "O-balance",
      case_id: caseRecord.case_id,
      household_id: "H01",
      entity_type: "debt",
      entity_id: source.debt_id,
      field: "balance",
      source_value: sourceBalance,
      override_value: sourceBalance + 5000,
      reason: "Statement confirmed",
      reported_to_backend: false,
      changed_by: "Elena Duarte",
      changed_at: AS_OF,
    };
    const edited = buildHouseholdOverview({
      householdId: "H01",
      caseId: caseRecord.case_id,
      overrides: [...caseOverrides, override],
      contacts,
      history: caseHistory,
      scenarios,
      extraPayments,
      customLoans,
    });
    if (!edited) throw new Error("H01 overview is missing after the balance edit");
    const row = debt(edited, source.debt_id);
    expect(row.balance.text).toBe(formatMoney(sourceBalance + 5000));
    expect(row.balance.override).toMatchObject({
      original: formatMoney(sourceBalance),
      next: formatMoney(sourceBalance + 5000),
      reason: "Statement confirmed",
      by: "Elena Duarte",
    });
    expect(row.balance.edit?.sourceText).toBe(formatMoney(sourceBalance));
    expect(source.balance).toBe(sourceBalance);
    const state = { overrides: [...caseOverrides, override], extraPayments, customLoans };
    const planned = householdWithCase("H01", state);
    expect(planned.debts.find((item) => item.debt_id === source.debt_id)?.balance).toBe(sourceBalance + 5000);
    const before = workspaceFor("H01", caseRecord.case_id, { overrides: caseOverrides, extraPayments, customLoans }, scenarios);
    const after = workspaceFor("H01", caseRecord.case_id, state, scenarios);
    expect(after?.cards.find((card) => card.origin === "today")?.interest).not.toBe(
      before?.cards.find((card) => card.origin === "today")?.interest,
    );
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
