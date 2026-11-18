# Cursor prompts, in order

Run these one at a time in Cursor **Agent** mode, in a new chat for each prompt (keeps context clean; the rules file in `.cursor/rules/` is loaded every time). Paste the prompt exactly. Don't move on until every "Done when" check passes. If Cursor says it added to `docs/OPEN_QUESTIONS.md`, read it before continuing.

---

## Prompt 1: Project scripts and data layer

```
Read @docs/SPEC.md, @docs/ENGINE.md and @docs/DATA.md before writing code.

Set up the data layer:
1. Add dev dependencies: vitest, @vitest/coverage-v8, tsx, papaparse, @types/papaparse. Add dependencies: zustand, date-fns, recharts, lucide-react.
2. Add npm scripts: "data": "tsx scripts/build-data.ts", "typecheck": "tsc --noEmit", "test": "vitest run", and make "prebuild" and "predev" run "npm run data".
3. Write scripts/build-data.ts. It reads every CSV in /data and writes typed JSON to src/data/<name>.json. Parse numbers as numbers, blanks as null, "True"/"False" as booleans. Keep every column.
4. Write src/lib/types.ts with a TypeScript type per file (Household, Member, Debt, Property, FastAppApproval, LoanProduct, PipelineResult, PipelineOffer, PipelineFlag, Case, CaseHistoryEvent, Scenario, ScenarioResult, ExtraPayment, CaseOverride, CustomLoan, ContactEvent, HouseholdOutreach) matching the CSV columns exactly.
5. Write src/lib/config.ts with AS_OF = "2026-11-14", PLAN_START = "2026-12", PAGE_SIZE = 25, ALERT_AMBER = 0.10, ALERT_RED = 0.25, TIE_WINDOW_MONTHS = 1, CAP_MONTHS = 600, DEFAULT_FICO = 740, and the waiting periods (90 / 90 / 365 days).
6. Write src/lib/data.ts with typed loaders and join helpers: getHousehold(id), membersOf, debtsOf, propertiesOf, offersOf, flagsOf, outreachOf, isFastAppApproved, productsFor(product).
7. Add a Vitest test that checks row counts: 299 households, 488 members, 1348 debts, 241 properties, 100 FastApp rows, 20 loan product rows, 93 cases, 406 contacts.

Don't build any UI yet.
```

**Done when:** `npm run data && npm run typecheck && npm run test` passes, and `src/data/` has one JSON file per CSV.

---

## Prompt 2: Calculation engine, matched to the fixtures

```
Read @docs/ENGINE.md carefully, then @reference/pipeline.py, @reference/advisor_inputs.py and @reference/cadence.py. Port the logic to pure TypeScript in src/lib/engine/, with no React imports:

- simulate.ts: simulate(debts, strategy, budget, extras?) returning { months: number | null, totalInterest, payoffOrder, schedule } where schedule has one row per month with each debt's opening balance, interest, payment and closing balance. Follow ENGINE.md section 2 exactly, including tie-breaks by list order, the 0.005 threshold and the 600-month cap.
- amortise.ts: loan payment.
- household.ts: validDebts, excludedDebts, todayPayment, householdFico (with default flag), flags (ENGINE.md section 6).
- offers.ts: buildOffers(household) per ENGINE.md section 4.
- bestPlan.ts: builtInPlans, bestOffer, bestPlan, monthsSaved, status, paymentAlert(monthly, today), suggestion(plans) per section 5, plus a plain-words "why it won" string (e.g. "5 months sooner and $18,200 less interest than avalanche" or "Tied on time; less interest").
- scenario.ts: runScenario(household, caseState, scenario) applying case overrides (payment, rate, excluded, property value, FICO, mortgage link, comfort zone), moved debts, a product or custom loan, and extra payments; returns months, interest, monthly, required monthly, payment change %, payment alert, schedule. After property value, FICO, mortgage link or comfort zone edits, re-run eligibility.
- outreach.ts: outreachStatus(contacts, asOf) per section 7.
- pipeline.ts: runPipeline() producing the same rows as pipeline_results.csv, pipeline_offers.csv and pipeline_flags.csv.

Tests in src/lib/engine/__tests__/:
1. H01 worked example from SPEC.md: current 240 months / $230,358; avalanche 134 / $145,717; snowball 134 / $145,800; Yellow 10-yr and 15-yr $35,000 = 129 months / $127,511; suggestion = HELOAN Yellow 180 months; Yellow available $80,000, Pink $125,000.
2. H11: nightly best FastApp 12 months, monthly $4,548, payment alert red.
3. For EVERY household, runPipeline() matches pipeline_results.csv (months exact, interest within $1, best plan, status, alert, rank), every row of pipeline_offers.csv, and every row of pipeline_flags.csv.
4. Every row of scenario_results.csv reproduces via runScenario (months exact, interest within $1, payment alert exact).
5. Every row of household_outreach.csv reproduces via outreachStatus with AS_OF.

If a fixture test fails, fix the port, not the fixture. If you believe a fixture contradicts SPEC.md, stop and write it up in docs/OPEN_QUESTIONS.md.
```

**Done when:** all tests pass. This is the step that guarantees the numbers in the UI match the doc.

---

## Prompt 3: App shell, user switcher and store

```
Using @docs/SPEC.md, build the app shell:
- Install shadcn/ui components: button, card, badge, table, tabs, select, input, dialog, sheet, tooltip, dropdown-menu, separator, alert, checkbox, radio-group, textarea, toast (sonner), pagination, skeleton.
- Layout: top bar with product name "Debt Free", a user switcher (the 5 advisors from households.csv, plus "Manager"), a "Demo date: 14 Nov 2026" label, and a "Reset demo data" action. Left nav: Opportunities (S1), Firm view (S7, only for Manager).
- Zustand store in src/lib/store.ts, persisted to localStorage under "debt-free-v1", seeded from cases, case_history, scenarios, extra_payments, case_overrides, custom_loans and contact_history JSON. Actions: startCase, addScenario, updateScenario, removeScenario, addExtraPayment, addOverride (always keeps source value, who, when, reason), addCustomLoan, recommend(scenarioId, ackReason?), recordDecision(caseId, outcome), logContact, reportDataIssue. Every action appends to case history.
- Derived selectors combine the engine with store state (never mutate source JSON).
- Routes: / (redirect to /opportunities), /opportunities, /households/[id], /households/[id]/workspace, /households/[id]/present, /households/[id]/summary, /firm.
- Formatting helpers in src/lib/format.ts: money "$12,345", months "11 years 2 months", dates "4 Sep 2027", percent "+191%".
Use a calm, professional visual style: neutral greys, one accent colour, amber and red only for payment alerts and data flags.
```

**Done when:** the app runs, switching user works, reset restores the seed, and every route renders a placeholder.

---

## Prompt 4: S1 Opportunity list (Journey 1)

```
Build /opportunities exactly as S1 in @docs/SPEC.md, using runPipeline results, outreachStatus and the store.
- Show only the selected advisor's households.
- Tabs: Ready to contact (default), Waiting, Progress check due, with counts.
- 25 per page, ranked by months saved (rule 6; "from never" first). Pagination at the bottom.
- Columns: household, months saved, interest saved, best plan type (No loan / FastApp / HELOAN Yellow / HELOAN Pink), nightly plan's payment alert (badge: none, amber, red with "+191%" and "$1,562 → $4,548"), eligible products, data flags (icon + tooltip listing each flag in plain words), case status, last contacted date ("Not contacted yet" if none), ready date (Waiting tab).
- Filters that combine: product, has flags, case status, minimum months saved. Sorts: months saved, interest saved, last contacted, days until ready.
- Empty and edge states from SPEC.md: nothing ready (message + next ready date + link to Waiting), "No action needed" ranked last (H12), pre-approved but no viable offer with the one-line reason (H04).
- Row click opens /households/[id].
```

**Done when:** as Pamela Wilson, the Ready tab is ranked by months saved and H01 is on the Waiting tab until 4 Sep 2027; as Tom Brennan, H11 (Waiting tab) shows a red alert of +191%, and H04 (Waiting tab) shows why it has no offer; as Elena Duarte, H12 shows "No action needed". (The sample households were all cased in the demo, so they're on Waiting.)

---

## Prompt 5: S2 Household overview

```
Build /households/[id] as S2 in @docs/SPEC.md.
- Header: name, advisor, state, comfort zone, household FICO (show which member's score is used; "740, estimated" with a flag if defaulted).
- Waiting banner when outreach status is waiting: last offer, outcome, "Ready from [date]". Casing stays allowed.
- Sections: members, properties (value date in red if stale), debts table (excluded debts greyed out with "not included in plans"), flags shown next to the value they affect using the "What the screens show" column of the data issues table, contact history, case history.
- "Edit for this case" on any household value (debt payment, rate, exclude a duplicate, property value, mortgage link, FICO, comfort zone): a dialog asks for the new value and a reason, then shows "original → new" inline with who and when. Never change source data.
- "Report data issue" next to every editable value, logged in case history.
- Primary action: "Start case" / "Continue case" to /households/[id]/workspace.
Check H07, H08, H09, H11, H15 and H16 against the data issues table.
```

**Done when:** every row of the data issues table behaves as written for its example household.

---

## Prompt 6: S3 Scenario workspace

```
Build /households/[id]/workspace as S3 in @docs/SPEC.md.
- Left: the built-in scenarios (current path, avalanche, snowball, one per eligible product offer from buildOffers) and the advisor's scenarios. Each card: name, debt-free in, total interest, months saved, monthly payment, payment alert badge.
- Scenario builder (sheet): strategy (avalanche or snowball), loan source (none / catalogue product / custom loan), product and term (only eligible ones; ineligible products listed with the reason), amount, debts to move (checkboxes, prefilled by rule 5, editable), custom loan (lender, rate, term, max amount), extra payments (one-off: amount + month; recurring: amount + start month).
- Every change recalculates with runScenario instantly (target under 1 second); show the payment alert live as values change.
- Edge states: no eligible products (avalanche and snowball only, with reasons); custom or edited loan that doesn't lower the blended rate or is below the minimum (allowed, labelled "won't save money" or "below minimum"); plan never pays off ("Never debt free at these payments").
- Select up to 4 scenarios to compare, then open S4.
```

**Done when:** on H01 the Yellow 15-year card shows 129 months and $127,511 with no alert; adding a $5,000 one-off in April 2027 updates the numbers immediately.

---

## Prompt 7: S4 Compare, schedule and recommend

```
Build the compare view as S4 in @docs/SPEC.md (a tab or panel within the workspace).
- Up to 4 scenarios side by side: debt-free date, months saved, total interest, monthly payment, payment alert. Avalanche and snowball are always included next to any loan scenario.
- Mark the tool's suggestion (rule 6) with the plain-words "why it won" (for H01: "5 months sooner and $18,200 less interest than paying smarter without a loan. Secured on your home."). On a tie, say which tie-break decided it.
- Month-by-month schedule for any scenario (table plus a stacked balance chart) and the payoff order.
- "Mark as recommended": if the plan has a payment alert, a dialog requires acknowledging it and a reason; if it differs from the suggestion, a reason is required. Both are saved to case history.
```

**Done when:** H01's suggestion is Yellow 15-year with the sentence above; recommending H11's FastApp 1-year forces an acknowledgement and a reason.

---

## Prompt 8: S5 Present mode

```
Build /households/[id]/present as S5 in @docs/SPEC.md: a full-screen, household-friendly view for a shared screen or a desk.
- Two large columns: "Today" (current path) and "Your plan" (recommended): debt free by (month and year), total interest, monthly payment, interest saved, months sooner.
- Payoff order as a simple timeline: which debt is cleared and when.
- If the plan includes a loan, say so plainly and say whether it is secured on the home.
- No data flags, jargon or spreadsheet grids. Household-relevant notes stay: "estimated" (default FICO) and "not included in this plan" (excluded debts).
- A discreet advisor control to switch to another compared scenario live, and to go back to the workspace for new facts.
- Buttons: "Agreed", "Not now" (declined), "Needs time" (undecided).
```

**Done when:** presenting H01 shows no flags or grids, and switching scenario updates every number.

---

## Prompt 9: S6 Decision, snapshot, one-pager and contact log

```
Build the decision step and /households/[id]/summary as S6 in @docs/SPEC.md.
- Recording a decision: logs a contact (date = AS_OF, channel chosen by the advisor: servicing call, outreach, household request), sets case status, starts the waiting period per the outreach table, and appends to case history. If the household is inside a waiting period and the channel is outreach, require a reason.
- Agreed: freeze a snapshot (inputs, edits, scenario, schedule, advisor, time). Later edits or data changes never alter it; S2 shows "Data has changed since this plan was agreed" if the source differs from the snapshot.
- One-pager at /households/[id]/summary, designed for one printed A4/Letter page (print CSS) with a "Download PDF" button that opens the browser print dialog: current path vs new plan, payoff order, debt-free date, interest saved, monthly payment, any loan and whether it's secured on the home, excluded debts, "estimated" note if FICO was defaulted, the simplification note, the advisor's name and date.
```

**Done when:** agreeing H07's plan moves it to Waiting with the right ready date, the PDF fits one page, and case history shows the full trail.

---

## Prompt 10: S7 Firm view

```
Build /firm as S7 in @docs/SPEC.md, visible only to "Manager".
- Filters: branch, advisor.
- Opportunity: households with an opportunity, split into ready now vs waiting.
- Funnel by advisor and branch: opportunity → cased → proposed → agreed.
- Results: agreed plans, total months saved and interest saved by agreed plans. Never show loan amounts or referrals.
- Every number drills down to the list of households behind it, and each household to its case and contact history (read-only).
```

**Done when:** the funnel counts match the store, and no loan amount appears anywhere on the page.

---

## Prompt 11: States and polish sweep

```
Go through every row of both tables in the "Missing data and error states" section of @docs/SPEC.md. For each row, find where it's implemented, fix anything missing, and add a test or a note. Also add: loading skeletons, a recalculation error state that keeps the last good result marked "stale" with retry, keyboard focus states, and a check that S3 to S5 recalculate in under 1 second for the largest household.
List each row with where it's handled in docs/STATES_CHECKLIST.md.
```

**Done when:** every row in `docs/STATES_CHECKLIST.md` points to code.

---

## Prompt 12: Acceptance audit

```
Go through every acceptance criterion in @docs/SPEC.md. For each one, test it in the running app (and with tests where possible), and write docs/ACCEPTANCE.md with: criterion, pass or fail, how it was checked, and the file that implements it. Fix every fail, then re-run the audit. Also confirm: no screen mentions referrals; no plan is ever hidden for its payment; source JSON is never mutated (add a test).
```

**Done when:** every criterion in `docs/ACCEPTANCE.md` says pass.

---

## Prompt 13: Deploy

```
Prepare for Vercel: make sure "npm run build" runs the data script first, there are no server-only file system reads at runtime (all data is bundled JSON), and add a short README section "Demo walkthrough" that walks H01 from the list to an agreed plan and shows H11's red alert. Then list the exact Vercel settings to use.
```

Then follow "Deploy to Vercel" in `README.md`.
