# Fix prompts, round 1

First replace `docs/SPEC.md` and `docs/ENGINE.md` in your project with the versions in this kit (they now include these changes). Then run these prompts in Cursor Agent mode, one new chat each, in this order. Commit after each one.

---

## Fix 1: Slow and unresponsive buttons

```
Buttons (Continue case, New scenario, Compare, and others) become unresponsive or respond late after using the app for a while. Find the cause before changing anything.

1. Profile it: add temporary timing logs (console.time) around runPipeline, runScenario, every Zustand selector that calls the engine, and every localStorage write. Reproduce: open H01, add 4 scenarios, change inputs several times, open Compare, go back to the list.
2. Check these likely causes and report which apply, with file and line:
   a. runPipeline() (all 299 households) runs on every render or inside a selector, instead of once at load and memoised.
   b. Engine calls inside components without useMemo, or selectors that return new arrays/objects each time, causing re-render loops.
   c. Every scenario's full month-by-month schedule is recalculated on every keystroke, even for scenarios that didn't change.
   d. Zustand persist writes the whole store (including schedules or derived data) to localStorage on every change, and the stored state keeps growing.
   e. Event handlers attached repeatedly, or dialogs/sheets left mounted with stale state that block clicks (invisible overlays with pointer-events).
3. Fix what you find:
   - Compute the nightly pipeline once at build or app load; memoise by input.
   - Memoise runScenario per scenario by a hash of its inputs; recompute only the scenario that changed.
   - Debounce number inputs by 150 ms; give the clicked button immediate feedback.
   - Persist only user-entered state (cases, scenarios, overrides, extras, custom loans, contacts, decisions, snapshots). Never persist derived results or schedules. Bump the persist version and migrate.
   - Make sure closed dialogs and sheets unmount and leave no overlay.
4. Prove it: add a test or script that runs 50 scenario edits on H01 and asserts each recalculation takes under 100 ms, and record before/after timings in docs/PERFORMANCE.md. Remove the temporary logs.
```

**Done when:** after 10 minutes of normal use, every button responds immediately and `docs/PERFORMANCE.md` shows before and after timings.

---

## Fix 2: Bottom action bar

```
Per @docs/SPEC.md (Screens to design), add a persistent action bar fixed to the bottom of S2, S3, S4 and S5.
- S2: Continue case (or Start case), Report data issue.
- S3: New scenario, Compare (shows count of selected scenarios, disabled until 2 are selected), Present.
- S4: Mark as recommended, Present, Back to scenarios.
- S5: Agreed, Not now, Needs time, Back to workspace (advisor-only, visually quieter).
The bar shows the household name on the left, stays visible while scrolling, never covers content (add bottom padding to the page), and works with the keyboard. Remove the duplicate buttons elsewhere on these screens so each action lives in one place.
```

**Done when:** on every one of S2 to S5 the main actions are visible without scrolling.

---

## Fix 3: Plan sources, current path highlight, and "Not comparable"

```
Per @docs/SPEC.md (S3, S4, rule 6, the data issues table) and @docs/ENGINE.md section 5:

1. Source labels on every scenario card and compare column:
   - "Current path": pinned first, always visible, highlighted as today's baseline (tinted background, "Today" label). It is never selectable as a recommendation target unless nothing beats it.
   - "Nightly best": the pipeline's best plan for this household, shown as is with its payment alert. Exactly one plan has this label.
   - "Built-in": avalanche, snowball and one per eligible product offer.
   - "Built by you": scenarios the advisor created. Rename any "Your scenarios" heading to "Built by you".
   - "Suggested" badge: the plan the tool suggests now by rule 6 across all scenarios in the case. It can be the same plan as Nightly best, or move to a plan the advisor built. Show both labels if both apply.
   Group S3 as: Current path → Nightly best → Built-in → Built by you. In S4, the Current path column is always first.
2. "From never" households (current path never pays off, e.g. H07):
   - S1 months saved shows "Never → 8 yrs 10 mos" (the best plan's time); interest saved shows "Not comparable" with a tooltip: "Today's payments never clear the debt, so there's no interest total to compare against." Show the best plan's own total interest beside it.
   - S3 and S4 show the current path as "Never debt free at these payments" and the same "Not comparable" treatment for savings.
   - Never display the raw values "from never", "n/a" or "—" for these.
   - Keep ranking them first (ENGINE.md section 5).
Add tests: H07 renders "Never → 8 yrs 10 mos" and "Not comparable"; H01 shows exactly one Nightly best label (HELOAN Yellow 15-year) and the Current path pinned first.
```

**Done when:** on H01 you can tell at a glance which plan is today's, which came from the nightly pipeline, which you built, and which the tool suggests; H07 shows no raw "—" or "n/a".

---

## Fix 4: Re-audit

```
Re-run the acceptance audit from @docs/SPEC.md and update docs/ACCEPTANCE.md, including the new criteria for H07, the action bar, source labels and button responsiveness. Fix any fails.
```
