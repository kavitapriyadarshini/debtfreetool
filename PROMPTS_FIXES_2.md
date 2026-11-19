# Fix prompts, round 2

First copy the updated `docs/SPEC.md` and `docs/ENGINE.md` from this kit into your project and commit them. Where this round conflicts with round 1 (Present on S3, "Never → x" labels), this round wins. Run in Cursor Agent mode, one new chat per prompt, commit after each, then `git push` to redeploy on Vercel.

---

## Fix 5: Household overview (S2) as tabs

```
Rework /households/[id] to match S2 in @docs/SPEC.md so it reads without much scrolling.
- Fixed summary header: household name, advisor, state, comfort zone, household FICO (who it comes from, or "740, estimated"), income, outreach status (and ready date if waiting), and "Plan in play saves: [months] and [interest] vs today" using the recommended plan if one is marked, otherwise the nightly best plan, labelled "Recommended" or "Nightly best". For households whose current path never pays off, show "Not comparable" with the tooltip from rule 6.
- Below the header, tabs that each render only their own data: Debts (default; flags inline, excluded debts greyed with "not included in plans"), Members, Properties, Contact history, Case history. Keep the selected tab in the URL (?tab=debts).
- Keep "Edit for this case" and "Report data issue" next to each value, in its tab.
- Bottom action bar on S2 shows only: Start case / Continue case. Remove Present from S2 entirely.
```

**Done when:** H01 shows its header and Debts tab with no scrolling on a laptop screen; switching tabs shows only that tab's data; there is no Present button on S2.

---

## Fix 6: Scenarios as one table (S3)

```
Rebuild the scenarios view in /households/[id]/workspace as the table in S3 of @docs/SPEC.md.
- Each plan is a column; each attribute is a row: source (Current path, Nightly best, Built-in, Built by you, plus a Suggested badge), debt free in, months saved, total interest, interest saved, monthly payment, payment alert, loan (product, term, amount) and whether it's secured on the home.
- Column order: Current path (pinned, highlighted as "Today"), Nightly best, Built-in, Built by you. The first column (row labels) and the Current path column stay sticky when scrolling sideways.
- A collapsible "Debts" row group: one row per debt, each cell showing that debt's debt-free month and year under that plan ("Mar 2029"), "Paid by new loan" if the plan moves it, "Not included" for excluded debts, "Never" if it never clears.
- A checkbox in each column header to tick up to 4 plans for Compare. Clicking a column header opens that plan in the builder (sheet) to edit it; built-in plans open a copy as "Built by you".
- Bottom action bar: New scenario, Compare (count ticked, enabled at 2 or more). No Present button here.
- Recalculation stays under 1 second (memoised per plan).
```

**Done when:** on H01 every plan is a column, the debt rows expand to show payoff dates per plan, and Compare enables once 2 plans are ticked.

---

## Fix 7: Compare (S4): select a card, then recommend

```
Rework the compare view per S4 in @docs/SPEC.md.
- Current path card first and highlighted, then the ticked plans as cards side by side, each with its source label, debt free by, months saved, total interest, interest saved, monthly payment and payment alert.
- Clicking a card selects it (clear selected state, keyboard accessible). The selected card's month-by-month schedule and payoff order show below. The tool's suggestion is badged with its plain-words "why it won".
- Bottom action bar: "Mark as recommended" (enabled only when a card is selected; the current path can't be recommended unless nothing beats it). Keep the acknowledgement dialog for payment alerts and the reason when it differs from the suggestion.
- After a plan is recommended, the action bar shows "Present" (and "Change recommendation"). Present must not appear anywhere before a plan is recommended; if someone opens /present without one, redirect to Compare with a message.
```

**Done when:** you can't reach Present on H01 until a card is selected and marked recommended.

---

## Fix 8: Present mode for the household (S5)

```
Rebuild /households/[id]/present per S5 and rule 9 in @docs/SPEC.md. The household is reading this, so use plain words throughout.
- Title: "Your plan: [plain plan name]" (e.g. "Pay off your cards with a home equity loan, then clear the rest in order"), with the advisor's name and date.
- Side by side: "Today" and "Your plan" in full colour; the other compared plans in grey columns to the right (click a grey column to switch to it live; advisor only). Rows: debt free by (month and year), how much sooner, total interest, interest you save, monthly payment, order your debts are paid off.
- "What's good about this plan" and "Things to know" built only from rule 9's fixed list and the plan's numbers. Never invent other statements.
- "Month by month": the schedule grouped by year (balance at the start and end of each year, debts cleared that year); expand a year to see each month: payment per debt, interest, balance. Show it for "Your plan", with a toggle to "Today".
- No data flags, codes or jargon ("APR" becomes "interest rate", "avalanche" becomes "highest rate first"). Keep "estimated" and "not included in this plan" notes.
- Bottom action bar: Agreed, Not now, Needs time, and a quieter "Back to workspace".
```

**Done when:** presenting H01's Yellow 15-year plan names the plan, shows Today vs Your plan with others in grey, lists advantages and things to know, and lets you walk 2027 month by month.

---

## Fix 9: The household's PDF after they agree (S6)

```
Update the decision step and /households/[id]/summary per S6 in @docs/SPEC.md.
- When the advisor clicks Agreed: freeze the snapshot, log the contact, start the waiting period, then show "Download the household's PDF" straight away.
- PDF page 1 (one page): plan name, Today vs Your plan, payoff order with dates, debt free by, interest saved, monthly payment, any loan and whether it's secured on the home, "What's good about this plan", "Things to know", excluded debts, "estimated" note, advisor name and date, simplification note.
- Then the month-by-month schedule pages (year headings, a row per month).
- Built from the frozen snapshot, so later edits never change it. Print CSS with page breaks; "Download PDF" opens the print dialog.
- Not now / Needs time: no PDF; just record the outcome and confirm the waiting period.
```

**Done when:** agreeing H01 offers the PDF immediately; page 1 fits one page and the schedule follows.

---

## Fix 10: Payment alert dots and "Not comparable"

```
Per rules 6 and 7 in @docs/SPEC.md:
- Replace every payment alert capsule with a small dot: amber or red, nothing for none. On hover or focus, a tooltip shows "Monthly payment $1,562 → $4,548 (+191%)". Add an accessible label so the dot isn't colour-only.
- For households whose current path never pays off (H07, H55, H82, H175, H291): months saved AND interest saved show "Not comparable", with the tooltip "Today's payments never clear these debts. With the best plan: debt free in [time]." Remove every "Never → x" label. Keep ranking them first.
- Update tests and docs/ACCEPTANCE.md for these, the tabs, the table, compare selection, present mode and the PDF.
```

**Done when:** no red capsules remain, H07 shows "Not comparable" with the tooltip, and the acceptance audit passes.
