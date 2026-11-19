# Fix prompts, round 6: present mode, the household PDF, responsiveness

Copy the updated `docs/SPEC.md` into your project first (S5, S6, rule 9 and acceptance changed). Run in Cursor Agent mode, one new chat each, commit after each, then push. Check with H275 (Isaac Parker): FastApp 2-year plan, no credit score on file.

---

## Fix 23: Payoff order table, data edits section, wording

```
Per S5, S6 and rule 9 in @docs/SPEC.md, in present mode AND the household PDF:
1. Payoff order is a table with columns: #, Debt, Interest rate, Paid off. Debts the new loan clears read "Upon starting new plan (Dec 2026)" (use the plan's first month), never "When the plan starts". Order by payoff date, then by the order they're cleared.
2. Edited values never appear inside the payoff order or next to a debt. Add a section "Data edits, if any" after "Things to know", one line per edit: field and debt, new value (was old value), reason, who, date. Example: "Prosper Personal, monthly payment: $1,400 (was $1,384) · more money · Pamela Wilson, 14 Nov 2026". Hide the section when there are no edits.
3. Wording: "Interest saved $164,733 less" becomes "Interest saved $164,733". Check every label in the Today / Your recommended plan block reads as plain English.
4. "Figures are estimated" appears only when no credit score is on file AND the plan's loan depends on FICO (a home equity loan). Never for FastApp or no-loan plans. When shown, say why: "Figures are estimated because there's no credit score on file." H275 (FastApp) must not show it.
```

**Done when:** H275's present screen and PDF show the payoff table with "Upon starting new plan (Dec 2026)", the edit only in "Data edits, if any", and no "Figures are estimated".

---

## Fix 24: "Year by year" in present mode

```
In S5 present mode, rename the "Month by month" section to "Year by year". Each year row (balance at start and end, debts cleared that year) expands to show its months (payment per debt, interest, balance). Keep the "Your recommended plan / Today" toggle. Use "Year by year" in any other place that shows this grouped view.
```

**Done when:** the section heading reads "Year by year" and each year expands to its months.

---

## Fix 25: One-page, two-column household PDF

```
Per S6 in @docs/SPEC.md, rebuild /households/[id]/summary as exactly one printed page (A4 and US Letter), two columns:
- Left column: household name, advisor and date; plan title ("Your recommended plan: [plain name]"); Today; Your recommended plan (debt free by, months sooner, total interest, interest saved, monthly payment, the loan and whether it's secured on the home); payoff order table; What's good about this plan; Things to know; Data edits, if any; the simplification note at the bottom.
- Right column: "Your schedule" in small type (8 pt): month by month for the first 24 months (month, total payment, interest, balance left, debts cleared), then one row per year until debt free (year, total paid, interest, balance at year end, debts cleared). Note above it: "Monthly for the first 2 years, then yearly."
- Print CSS: @page size A4/Letter with 12 mm margins, both columns fit one page, no page breaks, no app chrome (header, nav, buttons). Test the longest plan in the demo data: if it still overflows, shrink to 7 pt before anything else, and never drop rows silently.
- The on-screen preview shows the same layout. "Download the household's PDF" opens the print dialog.
Add a test that renders H275, H01 and the longest plan in the data and asserts the printable area is one page.
```

**Done when:** H275's PDF prints on a single page with the summary on the left and the schedule on the right.

---

## Fix 26: Buttons respond instantly

```
Some buttons still respond late or not at all. Find the cause with measurements, then fix it:
1. Check the production build first (npm run build && npm start, or the Vercel URL); dev mode is much slower. Record Interaction to Next Paint (INP) with the web-vitals library and the React Profiler while you: open H265, tick 3 plans, Compare, select a card, Mark as recommended, Present, Agreed, Download PDF.
2. Fix what you find. Likely causes, in order:
   a. The engine runs on the main thread during clicks: move simulate/runScenario/runPipeline into a Web Worker (or precompute), and wrap state updates that trigger recalculation in startTransition.
   b. A click updates the Zustand store and every component re-renders: use narrow selectors with shallow equality, and React.memo the table columns and cards.
   c. The persisted store writes to localStorage synchronously on every change: debounce persistence (300 ms) and persist only user inputs, never results or schedules.
   d. Route changes wait on work: prefetch /compare, /present and /summary, and render a skeleton immediately.
   e. Invisible overlays (closed dialogs, sheets, popovers) still catch clicks: ensure they unmount.
   f. Double submits: disable a button only while its own action runs, with a visible pending state.
3. Every button must show a pressed or pending state within 100 ms, and INP must be under 200 ms for every step above. Write the before/after numbers to docs/PERFORMANCE.md and add a Playwright test that clicks through the flow and fails if any step takes over 200 ms.
```

**Done when:** every button reacts within 100 ms on the Vercel URL, and `docs/PERFORMANCE.md` shows INP under 200 ms for each step.

---

## Fix 27: "Where the money goes" shows every line

```
Per S3 in @docs/SPEC.md, this reverses part of Fix 17:
1. In the S3 scenarios table, the "Where the money goes" row shows every event line in full in each plan's cell. Remove "Show all", "+2 more", "+3 more" and any truncation or line clamping from this row.
2. Keep the fixed column width: lines wrap inside the cell and the row grows taller, never wider. Each event is its own line, in date order, starting with the month ("Feb 2028: Capital One paid off; its $1,322 a month moves to Synchrony, now $1,891").
3. Keep the row group itself collapsible as a whole (expanded by default), so an advisor can fold it away when it's long.
4. Leave the Monthly payment row as it is (one summary line with "Show all").
```

**Done when:** on H265 every plan's "Where the money goes" cell lists all its events, and no column is wider than the others.
