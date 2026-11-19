# Fix prompts, round 7

Copy the updated `docs/SPEC.md` and `docs/ENGINE.md` into your project first. Where this round conflicts with earlier ones (Fix 25's two-column PDF with a schedule, Fix 8's grey plans in present mode, the "Nightly best" label), this round wins. Run in Cursor Agent mode, one new chat each, commit after each, then push.

---

## Fix 28: Rename "Nightly best" to "Pipeline recommended"

```
Rename the "Nightly best" badge (and "Pipeline suggested", if you already applied an earlier version of this prompt) and every mention of it in the UI to "Pipeline recommended" (S1 tooltips, S2 header, S3, S4, case history, tests). Keep the plain "Suggested" badge for the tool's live suggestion. Where a plan is both, show both badges. Search the codebase for "Nightly best", "nightly best" and "nightlyBest" labels shown to users and change them; internal variable names can stay.
```

**Done when:** "Nightly best" appears nowhere in the UI.

---

## Fix 29: S1 column order

```
In S1 (@docs/SPEC.md), order the opportunity table columns: Household, Best plan, Months saved, Interest saved, Payment alert, Eligible products, Data flags, Case status, Last contacted, Ready date (Waiting tab). Sorting and filters keep working.
```

**Done when:** "Best plan" is the second column.

---

## Fix 30: S3 column order

```
Per S3 in @docs/SPEC.md, order the scenarios table columns:
1. Current path (sticky, highlighted)
2. Pipeline recommended
3. Suggested (the tool's live suggestion), if it's a different plan from Pipeline recommended; if it's the same plan, that column shows both badges and there's no separate Suggested column
4. All other Built-in plans (avalanche, snowball, one per eligible product)
5. Built by you
When the suggestion changes (e.g. after an edit or a new scenario), the columns re-order to match.
```

**Done when:** on H280 the order is Current path, Pipeline recommended (FastApp 1-year), Suggested, then the rest.

---

## Fix 31: Present mode shows only today and the recommended plan

```
Per S5 in @docs/SPEC.md, present mode shows only two columns: Today and Your recommended plan. Remove the grey columns for other compared plans, the control to switch to them, and the "compared" query parameter. The payoff order tables then get the width they need (two side by side), so debt names and "Upon starting new plan (Dec 2026)" don't wrap word by word.
```

**Done when:** H280's present screen has exactly two plan columns.

---

## Fix 32: The household's PDF: back to a one-page summary, no schedule

```
Per S6 in @docs/SPEC.md, revert the two-column layout from Fix 25. The household's PDF is a one-page, single-column summary with no schedule:
household name, advisor and date; "Your recommended plan: [plain name]"; Today vs Your recommended plan (debt free by, months sooner, total interest, interest saved, monthly payment, the loan and whether it's secured on the home); the payoff order table (#, Debt, Interest rate, Paid off); What's good about this plan; Things to know; Data edits, if any; the simplification note.
Remove "Your schedule" and every schedule row from the PDF and its on-screen preview. The month-by-month view stays in present mode ("Year by year"). Keep the print CSS so it prints on one A4 or Letter page; test with the longest payoff order in the demo data.
```

**Done when:** H90's PDF is one page with the payoff table and no schedule.

---

## Fix 33: Edit and report as icons, including balances

```
Per S2 in @docs/SPEC.md:
1. Replace the "Edit for this case" and "Report data issue" text buttons with two icon buttons beside each editable value: a pencil (Edit for this case) and a flag (Report data issue). Each has a tooltip and an aria-label with the field name ("Edit Amex Gold balance"), a 32 px hit area, and a visible focus ring.
2. Add both icons to every debt's balance, as well as its interest rate and monthly payment, and to property value, FICO, comfort zone and the mortgage link. Editing a balance works like other edits: original shown, reason required, logged, recalculates every plan, never written to the source.
Update docs/ACCEPTANCE.md for fixes 28 to 33.
```

**Done when:** every debt row shows pencil and flag icons on balance, rate and payment, and editing a balance recalculates the plans.
