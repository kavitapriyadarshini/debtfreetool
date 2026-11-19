# Acceptance — fixes 20 to 22

Checked in the running app as Elena Duarte, demo date 14 Nov 2026. Each row is pass.

## Fix 20 — "(edited data)" only when a case has an edit

| Criterion | Result | How checked | Implementing file |
| --- | --- | --- | --- |
| Plan names carry "(edited data)" only when the case has at least one override. A case existing is not enough. | Pass | H01 (Patel, Raj and Anita) has a case and no overrides. The plans read Current path, Avalanche, and HELOAN Yellow 15-year. H55 (Amex payment edited) shows the suffix on every plan. Removing H55's overrides in a test drops the suffix; putting them back adds it. | `src/lib/case-inputs.ts`, `src/lib/workspace.ts` |
| 73 seeded scenarios named "Avalanche (edited data)" on cases with no overrides are renamed "Avalanche" at load and merge into the built-in column. Case history stays. The 20 cases that have overrides keep the longer name. | Pass | Source `scenarios.json` is unchanged (93 titles). After load, S0001 is "Avalanche" and shares the avalanche column. A version-2 browser state is migrated the same way and its history events are left in place. | `src/lib/case-inputs.ts`, `src/lib/store.ts` |
| Seeded names ending in " (nightly best)" drop that text at load and merge into the matching built-in offer. The Nightly best badge remains. | Pass | H01's Yellow column is "HELOAN Yellow 15-year", carries Nightly best, and keeps scenario S0002. No loaded name still ends in " (nightly best)". | `src/lib/case-inputs.ts`, `src/lib/store.ts` |

## Fix 21 — The suggestion never carries a payment alert

| Criterion | Result | How checked | Implementing file |
| --- | --- | --- | --- |
| The Suggested badge is chosen by the usual order, and only among plans whose payment alert is none. | Pass | Every household's suggested plan has alert none. On H01 the suggestion is "HELOAN Yellow 15-yr + extras", and the sentence names the $5,000 April bonus. | `src/lib/workspace.ts` |
| Plans with an alert stay listed and can be compared and recommended. The nightly best keeps its badge. When the two differ, both badges show. | Pass | On H11, FastApp 1-year keeps Nightly best and the red dot ($1,182 → $3,440, +191%). FastApp 3-year has Suggested and no dot. Both were ticked and opened on the comparison. | `src/lib/workspace.ts`, `src/components/compare-view.tsx` |
| The why sentence compares against a plan with no alert, and names a faster plan that raises the payment. | Pass | H11: "15 months sooner and $13,700 less interest than paying smarter without a loan. A faster plan (FastApp 1-year (edited data), 1 year) raises the monthly payment by $2,258 (+191%)." | `src/lib/workspace.ts` |

## Fix 22 — Compare and present wording

| Criterion | Result | How checked | Implementing file |
| --- | --- | --- | --- |
| On S4 the suggestion banner, including "Add to comparison", sits above the plan cards. | Pass | H01 compared with Avalanche. The banner ("Suggested HELOAN Yellow 15-yr + extras" and Add to comparison) is above the Current path and Avalanche cards. | `src/components/compare-view.tsx` |
| Once a card is selected, the section below is headed "With the selected plan: [plan name]" and contains Where the money goes, then the month-by-month schedule, then the payoff order. | Pass | Selecting Avalanche showed "With the selected plan: Avalanche", then Where the money goes, Month by month, and Payoff order. | `src/components/compare-view.tsx` |
| Present mode and the household PDF say "Your recommended plan" in the page title, the column heading, the schedule toggle, and the PDF. | Pass | H01 present title is "Your recommended plan: Pay off your cards with a home equity loan, then clear the rest in order". The column heading and the schedule toggle both read "Your recommended plan". A newly agreed PDF stores that title; the sheet's column heading is "Your recommended plan". An older saved title that still starts "Your plan:" is shown with the new words. H01 has no saved PDF in this browser, so the printed sheet itself was not on screen. | `src/lib/present.ts`, `src/components/present-room.tsx`, `src/components/summary-sheet.tsx` |
