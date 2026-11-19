# Fix prompts, round 4: scenarios table layout

Copy the updated `docs/SPEC.md` into your project first (S3 row and rule 10 changed). Run in Cursor Agent mode, one new chat each, commit after each. Check with H265 (Morgan, Hiroshi and Sara) and H55.

---

## Fix 17: Column widths and long values

```
The scenarios table in S3 (@docs/SPEC.md) grows one column very wide whenever a cell holds a long value (the current path's monthly payment changes, "Where the money goes"). Fix the layout:
1. Every plan column has the same fixed width (about 200 px, enough for "Paid by new loan" and "$350,447" on one line). At a 1440 px wide window at least 5 plan columns are fully visible; the rest scroll sideways. The row-label column and the Current path column stay sticky while scrolling sideways. Cells never widen their column; text wraps inside the cell.
2. Long values show one summary line and a "Show all" link that opens a popover with the full list:
   - Monthly payment: "$6,309 now · falls to $1,591 by Jun 2042" (H265 current path); "$3,408 now · $3,708 from Sep 2027" for plans with extras; a single value when it never changes.
   - Where the money goes: the first event, then "+N more".
3. Plan names that are too long wrap to two lines; never truncate mid-word without a tooltip.
4. Fix the page subtitle on S3: it says "Household overview"; it should say "Scenarios".
```

**Done when:** on H265 at 1440 px wide, Current path plus at least 5 plan columns are visible without scrolling, and no column is wider than the others.

---

## Fix 18: One source per plan, badges separate

```
Per rule 10 in @docs/SPEC.md:
1. The Source row shows exactly one value per plan: Today, Built-in or Built by you (the first that applies, in that order). "Avalanche (edited data)" in H265 must show only "Built-in".
2. Nightly best, Suggested and Previously recommended are badges shown under the plan name in the column header, not in the Source row.
3. When the advisor saves a scenario whose inputs are identical to an existing plan, show "Same as [plan name]" and don't create it. Seeded scenarios that duplicate a built-in plan merge into the built-in column (keep their history in case history).
4. A debt that appears twice because it was excluded as a duplicate (H265: Barclays View · 20.87% twice) shows once in the debt rows, with "Duplicate excluded in this case" in a tooltip, not as a second "Barclays View" row.
```

**Done when:** no plan in H265 or H55 shows two Source values, and Barclays View appears once.

---

## Fix 19: Visible compare tick boxes, fixed plan-rule strip

```
1. Compare tick boxes in S3: make them clearly visible: 20 px, a dark border (the app's primary text colour), the label "Compare" next to them, and a highlighted column outline when ticked. Keyboard focus ring visible. The counter in the action bar ("Compare 2") updates as they're ticked.
2. The current path column has no tick box; show "Always compared" in its place. It must not be possible to tick or untick it (H265 currently shows it ticked).
3. Move the plan rule text ("Every plan pays at least today's $6,309 a month; when a debt is paid off, its payment moves to the next debt (highest rate first for avalanche, smallest balance first for snowball)") out of the scrolling table into a fixed strip directly above the bottom action bar. It stays visible while the table scrolls in either direction, and can be collapsed to one line.
Update docs/ACCEPTANCE.md for fixes 17 to 19.
```

**Done when:** tick boxes are easy to spot at a glance, the current path can't be ticked, and the plan rule stays on screen while scrolling.
