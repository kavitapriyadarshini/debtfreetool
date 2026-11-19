# Fix prompts, round 5

Copy the updated `docs/SPEC.md` and `docs/ENGINE.md` into your project first. The demo data is unchanged. Run in Cursor Agent mode, one new chat each, commit after each, then push.

---

## Fix 20: "(edited data)" only when a case has an edit

```
Plan names show "(edited data)" in households whose case has no edits. Per rule 10 in @docs/SPEC.md and section 5 of @docs/ENGINE.md:
1. Compute hasEdits = the case has at least one override in the store. Append "(edited data)" to plan names (current path included) only when hasEdits is true. Never derive it from the case simply existing.
2. Seed data: 73 of the 93 seeded cases contain a scenario named "Avalanche (edited data)" with no overrides. At load (and in a persist migration for existing browsers), rename it "Avalanche" when the case has no overrides; it is then identical to the built-in avalanche and merges into that column (keep its history in case history).
3. Seeded scenario names ending in " (nightly best)" (e.g. H01's "HELOAN Yellow 15-yr (nightly best)") drop that text at load; the Nightly best badge already says it. Each is identical to a built-in offer, so it merges into that column.
4. Adding the first edit to a case adds the suffix to every plan immediately; removing the last edit removes it.
Tests: a case without overrides shows no "(edited data)" anywhere; H55 (Amex payment edited) shows it on every plan.
```

**Done when:** households without edits show plain plan names, and H55 still shows "(edited data)".

---

## Fix 21: The suggestion never carries a payment alert

```
Per rule 6 in @docs/SPEC.md and section 5 of @docs/ENGINE.md: the Suggested badge picks, by the usual order, only among plans whose payment alert is none (no amber, no red). Avalanche and snowball never raise the payment, so a candidate always exists.
- Plans with alerts stay listed and can still be compared and recommended (with the acknowledgement and reason).
- The nightly best keeps its own badge and may carry an alert; when it does, it won't be the suggestion. Show both badges where they differ.
- The "why it won" sentence compares against the fastest plan without an alert, and if a faster plan with an alert exists, adds: "A faster plan ([name], [time]) raises the monthly payment by [amount] (+[%])."
- Don't test suggestions against advisor_reason or is_recommended in the seed files; they predate this rule.
Tests: H11's suggestion is a plan with no alert (not FastApp 1-year); no case anywhere has a Suggested plan with an amber or red dot.
```

**Done when:** no Suggested badge sits on a plan with an amber or red dot. On H01 the suggestion is "HELOAN Yellow 15-yr + extras" (126 months), because the seeded $5,000 April bonus belongs to that scenario; its sentence must name the bonus.

---

## Fix 22: Compare and present wording

```
Per @docs/SPEC.md S4 and S5:
1. S4: move the suggestion banner (with "Add to comparison") back above the plan cards.
2. S4: once a card is selected, the section below the cards is headed "With the selected plan: [plan name]", and contains Where the money goes, then the month-by-month schedule and payoff order.
3. S5 present mode and the household PDF: rename "Your plan" to "Your recommended plan" everywhere: the page title ("Your recommended plan: [plain name]"), the column heading, the schedule toggle, and the PDF.
Update docs/ACCEPTANCE.md for fixes 20 to 22.
```

**Done when:** the banner sits above the cards, the selected-plan section has its heading, and present mode says "Your recommended plan".
