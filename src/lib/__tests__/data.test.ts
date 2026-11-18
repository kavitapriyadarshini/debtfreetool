import { describe, expect, it } from "vitest";
import {
  cases,
  contacts,
  debts,
  debtsOf,
  fastAppApprovals,
  getHousehold,
  households,
  isFastAppApproved,
  loanProducts,
  members,
  membersOf,
  productsFor,
  properties,
} from "../data";

describe("bundled dataset", () => {
  it("has the expected row counts", () => {
    expect(households).toHaveLength(299);
    expect(members).toHaveLength(488);
    expect(debts).toHaveLength(1348);
    expect(properties).toHaveLength(241);
    expect(fastAppApprovals).toHaveLength(100);
    expect(loanProducts).toHaveLength(20);
    expect(cases).toHaveLength(93);
    expect(contacts).toHaveLength(406);
  });

  it("parses numbers, blanks and booleans and joins a household", () => {
    const household = getHousehold("H01");
    expect(household?.household_name).toBe("Patel, Raj and Anita");
    expect(household?.comfort_zone).toBe(2);
    expect(household?.annual_income).toBe(165000);

    const anita = membersOf("H01").find((member) => member.member_id === "H01-M2");
    expect(anita?.fico).toBeNull();
    expect(debtsOf("H01").every((debt) => typeof debt.balance === "number")).toBe(true);

    const agreed = contacts.find((contact) => contact.contact_id === "K00001");
    expect(agreed?.plan_presented).toBe(true);
    expect(agreed?.includes_new_loan).toBe(true);

    expect(isFastAppApproved("H01")).toBe(false);
    expect(isFastAppApproved("H02")).toBe(true);
    expect(productsFor("FastApp")).toHaveLength(13);
    expect(productsFor("HELOAN Yellow")).toHaveLength(5);
    expect(productsFor("HELOAN Pink")).toHaveLength(2);
  });
});
