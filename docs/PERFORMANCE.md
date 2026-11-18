# Performance

Profiled before any fix with `console.time` around `runPipeline`, `runScenario`, `selectHouseholdView`, and each `localStorage` write. The reproduction was H01: open the household, add scenarios, change inputs, open Compare, then return to the list. Those logs are removed.

## What applied

| Check | Result | Where |
| --- | --- | --- |
| `runPipeline()` for all 299 households on every render | No. The list cached the first result in `pipelineIndex`. A second list was about 0 ms. The first direct `runPipeline()` was 70 ms, and calling it again was still 34 ms because the cache lived only in the list. | `src/lib/opportunity.ts` (cache), `src/lib/engine/pipeline.ts` `runPipeline` |
| Engine calls inside render, or selectors that return new objects and loop | No loop. Screen selectors read store slices and do not call the engine. `selectHouseholdView` does call `runScenario` for every scenario and returns a new object, and no screen uses it. Workspace, compare, present, and firm recalculate inside `useKeptResult`, which only reruns when its inputs change. | `src/lib/selectors.ts` `selectHouseholdView`, `src/components/kept-result.tsx` |
| Every scenario's full schedule on every keystroke, including scenarios that did not change | Yes. `runScenario` always built the month-by-month schedule and rebuilt offers. The workspace did that for every saved scenario. The builder preview did it on each draft change. Compare ran the workspace and then `runScenario` again for each column. Saving a scenario ran every scenario on the case again. On H01 one run was about 0.2–0.5 ms, so the freeze was repeated work, not one slow household. | `src/lib/engine/scenario.ts` `runScenario`, `src/lib/workspace.ts` `assembleWorkspace` and `previewDraft`, `src/lib/compare.ts` `compareFor`, `src/lib/store.ts` `suggestedScenarioId` |
| Persist writes the whole store, including schedules, and the saved state grows | Yes. Every store change wrote the seed book (about 284 KB) plus snapshots, and each snapshot kept its full schedule. Typing in the builder did not write. Adding a scenario, an edit, or an agreement did. | `src/lib/store.ts` `partialize`, `src/lib/snapshot.ts` `FrozenSnapshot.schedule` |
| Handlers attached over and over, or a closed dialog left an overlay that ate clicks | The close animation left the dialog and sheet backdrop mounted, and that backdrop still received clicks while it was closing. A busy moment could leave it there, which matches a button that does nothing and then works. Handlers are not registered again on each render. | `src/components/ui/dialog.tsx` `DialogOverlay`, `src/components/ui/sheet.tsx` `SheetOverlay`, and the dialogs in `workspace.tsx`, `household-overview.tsx`, `compare-view.tsx`, `present-room.tsx` |

## Before and after

Same machine, H01, demo seed. Times are milliseconds.

| Step | Before | After |
| --- | --- | --- |
| `runPipeline()` first call | 70 | 67 |
| `runPipeline()` second call | 34 | 0 (same object) |
| Opportunity list, second pass | 0 (in-memory cache of a fresh pipeline) | 0 (bundled nightly JSON, no engine call) |
| One H01 `runScenario` | 0.2–0.5 | under 1 on a cache miss; a repeat does not compute |
| Workspace for H01 | 2 | 2.7 |
| Compare one H01 loan column | 4 | 3.1 |
| 50 edits, recomputing every H01 scenario each time | max 2 | — |
| 50 edits, recompute only the scenario that changed | — | max 1; 50 new computes, the other scenarios stay cached |

`src/lib/__tests__/performance.test.ts` runs those 50 edits and asserts each pass is under 100 ms. It also checks that a saved agreement stores an empty schedule while the in-memory snapshot still has the real one.

## What changed

- The opportunity list reads the nightly pipeline JSON produced by `npm run data`. `runPipeline()` still exists for the engine and is memoised for the life of the page.
- `runScenario` keeps a result per hash of the household, the case edits, and the scenario. A later call with the same inputs returns that result. Changing one scenario does not simulate the others again.
- Amount, rate, term, maximum, and extra-payment amount wait 150 ms before the preview runs. Product, term, strategy, and debt choices update immediately. Continue case, New scenario, Compare, and Save scenario show a working label before the navigation or save.
- Persisted state is version 2: the signed-in user, cases, history, scenarios, overrides, extras, custom loans, contacts, and snapshots. Snapshot schedules are stored as an empty list. Older saves are migrated by clearing those schedules. The open page still keeps the schedule in memory for the session that created it.
- A closed dialog or sheet unmounts. A backdrop that is closing does not receive clicks.
