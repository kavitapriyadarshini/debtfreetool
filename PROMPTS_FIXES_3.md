# Fix prompts, round 3

Copy the updated `docs/SPEC.md` into your project first (new rule 10, and changes to S2 to S5). Run after rounds 1 and 2, in Cursor Agent mode, one new chat each, and commit after each. Use household H55 to check: its case corrects the Amex payment from $307 to $827.

Reference numbers for H55 on the case's data (from `reference/pipeline.py`): current path 36 months, $21,538; avalanche 25 months, $18,234; snowball 25 months, $18,533. On the source data: current path never pays off; avalanche 31 months, $23,715.

---

## Fix 11: One set of inputs per case (rule 10)

```
Implement rule 10 in @docs/SPEC.md ("Comparing plans fairly"), first bullets. H55 shows the bug: the "Nightly best" avalanche column shows 31 months and $2,888 a month from the source data, but its debt rows use the case's edited data, and its savings are measured against a current path built on edited data.

1. Build one "case inputs" object: source data plus the case overrides to today's facts. Calculate the current path from it once per case version and freeze it; nothing else may change it (no plan, loan, extra, or recalculation).
2. Calculate every plan in the case, including the nightly best, from the same case inputs. When the case has edits, every plan computed on them, the current path included, carries "(edited data)" after its name ("Current path (edited data)"); the nightly plan keeps its Nightly best label. A column must never mix inputs.
3. On S1, a household with case edits shows the case's months and interest saved, marked "Updated in case", with the nightly figure in a tooltip. H55 must show 11 months saved and $3,304 interest saved (avalanche on case data), not "Not comparable".
4. Savings carry their sign everywhere: "Costs $2,177 more", "6 months later". Never clamp to $0 or "—".
5. Plans with identical inputs (e.g. Nightly best recalculated = "Avalanche (edited data)") show once, with all their labels.
Add tests with the H55 reference numbers above.
```

**Done when:** H55's current path is 36 months in every screen, the nightly column shows 25 months and $18,234, no plan for H55 shows $2,888, and S1 shows 11 months saved marked "Updated in case".

---

## Fix 12: Extra payments, invalid loans, unique names

```
Per rule 10 in @docs/SPEC.md:
1. Extra payments stay with the scenario they were entered in. Label that scenario "Includes extra payments". Its monthly payment shows when it changes: "$3,408; $3,708 from Sep 2027" (H55, "Avalanche + extras"), not $3,708 from day one. The payment alert uses the highest monthly amount. Any "why it won" sentence that picks a plan with extras names them: "...including a $13,300 lump sum in Dec 2026".
2. A catalogue or custom loan with no debts ticked to move is invalid: show "This loan doesn't pay off any debt" in the builder and on its column, and leave it out of the suggestion and of Compare.
3. Scenario names must be unique within a case, case-insensitive, including built-in names (Current path, Avalanche, Snowball, product names). Show the error inline in the builder and keep Save disabled until fixed.
```

**Done when:** H55's "Avalanche + extras" shows the stepped payment; a custom loan with no debts ticked can't be compared or suggested; naming a scenario "snowball" is refused.

---

## Fix 13: Compare (S4): 3 plans plus today, suggestion below

```
Rework S4 per @docs/SPEC.md:
1. The current path is always the first card. The advisor ticks up to 3 plans in S3; the Compare button reads "Compare 3". Remove the 4-plan limit and the line "Only four plans fit side by side".
2. Rename the "Your pick" label to "Previously recommended", and put it only on the scenario recorded as recommended in the case.
3. Move the suggestion banner below the plan cards. If the suggested plan is not among the cards, show "Add to comparison": it replaces the compared plan with the fewest months saved (never the current path) and says which one it replaced. If 3 aren't selected yet, it just adds it.
4. The "why it won" sentence must use the exact numbers on the cards it compares (rounded to the nearest $100) and, if the plan has a payment alert, end with "...but raises the monthly payment by $905 (+27%)".
```

**Done when:** H55 compares today plus 3 plans, the suggestion sits below the cards with a working "Add to comparison", and "Your pick" no longer appears.

---

## Fix 14: Where the money goes (S3 and S4)

```
Per rule 10 in @docs/SPEC.md, show how payments move under each plan:
1. Add to the engine a list of payment events per plan, derived from the schedule: month, event, amounts. Events: a debt paid off and its payment moving to the next target (with that target's new monthly payment); a new loan paying off debts in month 1 (which debts, their combined payment stopping, the loan's payment starting, and where the difference goes); an extra payment starting or landing.
2. S3: a collapsible "Where the money goes" row under the debt rows, showing each plan's events in short lines.
3. S4: for the selected card, a "Where the money goes" panel above the schedule, in plain sentences, e.g. "Feb 2028: Capital One paid off; its $1,322 a month moves to Synchrony, now $1,891." For H01 Yellow 15-year, month 1 reads: "New loan of $35,000 pays off Chase, Citi and SoFi; their $1,050 a month stops; the loan's $332 starts; the other $718 goes to the new loan, the highest rate left."
Test both examples.
```

**Done when:** for H01's Yellow 15-year and H55's avalanche, the sentences above appear exactly.

---

## Fix 15: Interest rates on debts, and present-mode duplicates

```
1. Show each debt's interest rate everywhere a debt is listed: S2 Debts tab (balance, interest rate, monthly payment columns), S3 debt rows ("Amex Gold · 28.07%"), S4 and S5 payoff order.
2. A new loan (catalogue or custom) always appears as its own row in every debts list for that plan ("New loan · HELOAN Yellow · 7.875%" with its payoff month), so the last payoff date in a column always equals the plan's debt-free date.
3. Present mode (S5): show each distinct plan once in the grey columns (dedupe by identical inputs). Give each grey column its plain name and its source in small text, so two different plans never share a title.
4. Re-run the acceptance audit and update docs/ACCEPTANCE.md for fixes 11 to 15. Add a test for every household: in every plan, the latest debt payoff month equals the plan's debt-free month.
```

**Done when:** H55's present screen has no repeated column and every debt shows its rate.

---

## Fix 16: Edited cells, resolved flags, and a self-check on every plan

```
Per rule 10 in @docs/SPEC.md:
1. Any value edited in a case shows, in its cell: the new value, "was [original]", the latest reason, who and when. H55 Amex payment: "$827 (was $307) · Household confirmed their actual monthly payment · Pamela Wilson, 21 Oct 2026". Remove the invented note "Never pays off at the original payment".
2. Re-check flags on the case inputs. A flag raised on source data that a case edit resolves (H55: payment_below_interest) shows as "Resolved in this case" with the edit, not as an active warning. Flags that still apply stay active.
3. Add an engine test over every household and every plan: opening balances + total interest = total paid (sum of all payments in the schedule), within $1; and the last month's closing balances are all 0 unless the plan is "never".
4. Under the S3 table, add one line: "Every plan pays at least today's $X a month; when a debt is paid off, its payment moves to the next debt (highest rate first for avalanche, smallest balance first for snowball)."
```

**Done when:** H55's Amex cell shows the edit and reason, its flag reads "Resolved in this case", and the add-up test passes for all 299 households.

---

## Fix 16: Show the arithmetic, and edits in the cell

```
Per rule 10 in @docs/SPEC.md:
1. Edited values show their story in the cell, everywhere they appear (S2 Debts tab, S3 debt rows, S4): "$827 (was $307) · Household confirmed their actual monthly payment · Pamela Wilson, 21 Oct 2026", using the most recent edit's reason. Flags are recalculated on the edited value: a flag the edit resolves (e.g. Amex Gold's payment below interest) shows "Resolved in this case" instead of a warning like "Never pays off at the original payment".
2. Monthly payment row: show today's amount and when it changes. Current path falls as debts clear (H55: "$3,408; $2,086 from Mar 2028"), rollover plans stay level at $3,408, extras step up ("$3,408; $3,708 from Sep 2027").
3. Add an engine check that runs for every plan: opening balances + total interest = total paid (within $1). Fail the test suite if any plan breaks it.
4. Add a "How this is calculated" link on S3 that opens a side panel for the selected plan: budget per month, which debt gets the spare money and why (highest rate / smallest balance), and each payoff event, using the "Where the money goes" lines.
Test with H55: current path 36 months, $21,538; avalanche (edited data) 25 months, $18,234; snowball (edited data) 25 months, $18,533.
```

**Done when:** Amex Gold in H55 shows the edit and its reason in the cell with no active warning, and every plan passes the add-up check.
