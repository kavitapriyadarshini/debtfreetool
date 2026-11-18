import { WAITING_PERIODS } from "../config";
import type { ContactEvent, OutreachStatus } from "../types";

export type OutreachResult = {
  last_contacted_at: string | null;
  days_since_last_contact: number | null;
  last_contact_channel: ContactEvent["channel"] | null;
  last_offer_at: string | null;
  last_offer_outcome: string | null;
  last_offer_included_loan: boolean | null;
  cooling_off_rule: string | null;
  eligible_for_outreach_from: string | null;
  days_until_eligible: number;
  outreach_status: OutreachStatus;
};

function parseUtc(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day);
}

function formatUtc(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(iso: string, days: number): string {
  return formatUtc(parseUtc(iso) + days * 86_400_000);
}

function daysBetween(later: string, earlier: string): number {
  return Math.round((parseUtc(later) - parseUtc(earlier)) / 86_400_000);
}

/** Days until another proactive offer. A contact with no plan presented starts no window. */
function waitingDays(contact: ContactEvent): number {
  if (!contact.plan_presented) return 0;
  if (contact.outcome === "agreed") {
    return contact.includes_new_loan === true
      ? WAITING_PERIODS.agreedWithLoan
      : WAITING_PERIODS.agreedNoLoan;
  }
  return WAITING_PERIODS.presentedDeclinedOrUndecided;
}

function coolingRule(contact: ContactEvent | null): string | null {
  if (!contact) return null;
  if (contact.outcome === "agreed" && contact.includes_new_loan === true) return "agreed_loan_365d";
  if (contact.outcome === "agreed") return "agreed_no_loan_90d";
  return `${contact.outcome}_90d`;
}

/**
 * Latest offer end-date wins. Waiting while that date is still ahead of `asOf`.
 * An agreed plan with no new loan becomes a progress check once the window has passed.
 */
export function outreachStatus(contacts: readonly ContactEvent[], asOf: string): OutreachResult {
  const ordered = contacts
    .map((contact, index) => ({ contact, index }))
    .sort(
      (a, b) =>
        a.contact.contacted_at.localeCompare(b.contact.contacted_at) || a.index - b.index,
    )
    .map((row) => row.contact);

  let last: ContactEvent | null = null;
  for (const contact of ordered) {
    if (!last || contact.contacted_at > last.contacted_at) last = contact;
  }

  const presented = ordered.filter((contact) => contact.plan_presented);
  let binding: ContactEvent | null = null;
  let end: string | null = null;
  for (const contact of presented) {
    const contactEnd = addDays(contact.contacted_at, waitingDays(contact));
    if (!end || contactEnd > end) {
      end = contactEnd;
      binding = contact;
    }
  }

  const waiting = end != null && end > asOf;
  let outreach_status: OutreachStatus = "ready";
  if (waiting) outreach_status = "waiting";
  else if (binding?.outcome === "agreed" && binding.includes_new_loan === false) {
    outreach_status = "progress_check_due";
  }

  const lastOffer = presented.length > 0 ? presented[presented.length - 1]! : null;
  return {
    last_contacted_at: last?.contacted_at ?? null,
    days_since_last_contact: last ? daysBetween(asOf, last.contacted_at) : null,
    last_contact_channel: last?.channel ?? null,
    last_offer_at: lastOffer?.contacted_at ?? null,
    last_offer_outcome: lastOffer?.outcome ?? null,
    last_offer_included_loan: lastOffer ? lastOffer.includes_new_loan : null,
    cooling_off_rule: coolingRule(binding),
    eligible_for_outreach_from: end,
    days_until_eligible: waiting && end ? daysBetween(end, asOf) : 0,
    outreach_status,
  };
}
