# Button response

Measured on a production build (`next build` then `next start`), not the dev server. Interaction to Next Paint comes from the Event Timing API, which is what the `web-vitals` library reports as INP. A click the browser rounds below its 16 ms reporting threshold is shown as under 16. Pressed means the control showed a pending outline or label.

The engine was timed separately on H265: the nightly pipeline takes 73 ms the first time and is then cached; one workspace is 8 ms, a three-plan compare is 7 ms, present is 6 ms, and saving the agreement snapshot is 4 ms. No long task ran during the clicks, so the calculation was not moved onto a worker.

## Before

`web-vitals` `onINP` for the whole session: **48 ms** (good).

| Step | Click INP | Click work | Until the next screen |
| --- | ---: | ---: | ---: |
| Open H265 | 24 ms | 2 ms | 107 ms |
| Continue case | 16 ms | 1 ms | 101 ms |
| Tick plan 1 | 16 ms | 3 ms | counter updated |
| Tick plan 2 | 16 ms | 3 ms | counter updated |
| Tick plan 3 | 16 ms | 4 ms | counter updated |
| Compare | 24 ms | 6 ms | 82 ms |
| Select a card | 32 ms | 7 ms | 45 ms |
| Mark as recommended | 40 ms | 14 ms | 50 ms |
| Confirm recommendation | 48 ms | 7 ms | 45 ms |
| Present | 16 ms | 1 ms | 72 ms |
| Agreed | 40 ms | 4 ms | 41 ms |
| Save agreement | 32 ms | 7 ms | 71 ms |
| Download PDF | 16 ms | 0 ms | 19 ms |

Opening a household and continuing the case took just over 100 ms to show the next screen, and those controls did not show a pending state of their own. A press also re-rendered the scenario table before the button could change. Writing the demo to `localStorage` was synchronous on every change (about 365 KB; the stringify itself was under 1 ms).

## After

Same flow, production build, Playwright. `onINP` stayed within the 200 ms limit. Every step showed a pressed state in under 100 ms.

| Step | Click INP | Pressed state |
| --- | ---: | ---: |
| Open H265 | under 16 ms | 22 ms |
| Continue case | 16 ms | 30 ms |
| Tick plan 1 | 16 ms | 31 ms |
| Tick plan 2 | 16 ms | 31 ms |
| Tick plan 3 | 16 ms | 31 ms |
| Compare | 16 ms | 33 ms |
| Select a card | 32 ms | 32 ms |
| Mark as recommended | 16 ms | 32 ms |
| Confirm recommendation | 32 ms | 29 ms |
| Present | 16 ms | 32 ms |
| Agreed | 32 ms | 32 ms |
| Save agreement | 32 ms | 31 ms |
| Download PDF | 16 ms | 28 ms |

React Profiler is mounted on the workspace, compare, present, and summary screens. The follow-up render is deferred with `startTransition`, so the pressed state paints before that commit.

## What changed

- A press paints a pending outline immediately, and the button’s own label switches to Opening…, Saving…, or Preparing…. Only that button is disabled while its action runs.
- The scenario table is memoized, so a button press does not redraw every plan column. The compare chart is memoized. Selecting a card, recommending, and saving defer the heavy update with `startTransition`.
- The browser copy of the demo is written 300 ms after the last change, and again when the page is hidden. The stored snapshot still drops the month-by-month schedule and keeps the year rows the one-page PDF needs. Node tests still write through immediately.
- The household screen prefetches the workspace, present, and summary routes. Choosing plans prefetches that compare URL. Each of those routes renders a skeleton while the page loads.
- Closed dialogs, sheets, popovers, and tooltips unmount (`keepMounted` is false), so a hidden layer cannot take the next click.

`e2e/advisor-flow.spec.ts` repeats this flow and fails if any step’s click is over 200 ms or its pressed state is over 100 ms. Run it against a production build with `npm run build && npm run e2e`.
