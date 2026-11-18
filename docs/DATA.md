# Debt Free tool: extrapolated demo dataset

299 households, 5 advisors, 2 branches, about 12% of generated households carrying deliberate data errors.
Built from the 16-household sample, which is kept unchanged (H01 to H16). Deterministic: rerunning the scripts gives the same files.

Rates as of 2026-11-11 (FastApp) and 2026-10-30 (home equity). Plan month 1 = December 2026.

## Files

### 1. Source data (what reloads every night; read-only in the tool)

| File | Rows | What changed from the sample |
| --- | --- | --- |
| `households.csv` | 299 | Added `branch`; added advisors Priya Raman and Marcus Webb |
| `household_members.csv` | 488 | Same schema; about 15% of members have no FICO |
| `debts.csv` | 1,348 | Same schema |
| `properties.csv` | 241 | Same schema |
| `fastapp_list.csv` | 100 | Same schema; includes 3 orphans (H22, H950, H951) |
| `loan_products.csv` | 20 | Unchanged |

`monthly_payment` is what the household actually pays (confirmed by the firm), not the minimum due.

### 2. Pipeline output (built-in plans, precomputed nightly)

The pipeline's best plan is shown as is: it follows the brief's rule and is never filtered by payment. A plan that raises today's monthly payment carries a payment alert instead. The advisor treats it as a starting point, not the answer.

| File | One row per | Used by |
| --- | --- | --- |
| `pipeline_results.csv` | household | S1 opportunity list, S7 firm view: FICO used, current path, avalanche, snowball, best offer, nightly best plan with its monthly payment, payment change % and payment alert, months and interest saved, status, flags, rank within advisor |
| `pipeline_offers.csv` | eligible product x term x property | S3 built-in loan scenarios: every eligible offer with amount, debts paid off, loan payment, contractual monthly, payment change %, payment alert, months, interest |
| `pipeline_flags.csv` | data issue found | Flags on S1, S2 |

### 3. Advisor-built inputs (what advisors learn on calls; stored per case)

| File | One row per | Holds |
| --- | --- | --- |
| `cases.csv` | case | Household, advisor, branch, status (in_progress, proposed, agreed, declined, undecided), the tool's suggested scenario, the advisor's recommended scenario, whether they differ, decision |
| `case_history.csv` | event | Audit trail: created, override, extra payment, custom loan, scenario added, payment alert acknowledged, recommended, presented, decision, snapshot frozen |
| `scenarios.csv` | advisor scenario | Strategy, loan source (none, product, custom), product, term, amount, rate, debts paid off, extra payments used, recommended, advisor's reason |
| `scenario_results.csv` | advisor scenario | Expected months to debt free, interest, monthly payment, today's confirmed payment, payment change %, payment alert (for testing the tool's maths and alerts) |
| `extra_payments.csv` | extra payment | One-off (bonus, tax refund, savings upfront) or recurring (raise, spare cash), amount, start month, reason |
| `case_overrides.csv` | case-level edit | Entity, field, source value, new value, reason, reported to backend, who and when |
| `custom_loans.csv` | custom loan | Lender name, rate, term, max amount (for loans not in the catalogue) |

### 4. Contact history and cooling-off (recorded by the tool, not in the source data)

| File | One row per | Holds |
| --- | --- | --- |
| `contact_history.csv` | contact | Date, channel (servicing call, advisor outreach, household request), who started it, whether a plan was presented, outcome (agreed, declined, undecided, presented, no offer), whether the plan includes a new loan, case and scenario, and a reason if the advisor contacted inside a waiting period |
| `household_outreach.csv` | household | Last contacted date and channel, days since, last offer and outcome, the cooling-off rule that applies, eligible-for-outreach date, days until eligible, outreach status (`ready`, `waiting`, `progress_check_due`) |

Status as of 2026-11-14: 202 ready, 87 waiting, 10 progress check due. Every rule has households both inside and past its window. Two contacts inside a waiting period carry an override reason (H131, H299).

### 5. QA

`qa_expected_data_issues.csv` lists every data issue planted or occurring naturally. Every row is caught by `pipeline_flags.csv` (checked: 0 missed, 0 unexpected).

## Data issues planted, and the rule applied

| Issue | Count | Rule (from the firm or our assumption) |
| --- | --- | --- |
| No FICO for any member | 25 households (8 planted, rest natural) | Use 740; flag "estimated" |
| $0 monthly payment (incl. reverse mortgages) | 9 debts | Exclude from all calculations; flag |
| Payment below monthly interest | 5 | Include; flag "never pays off"; advisor can edit |
| 0% rate | 4 | Include; flag; advisor can edit |
| Possible duplicate debt | 4 | Keep both; flag; advisor can exclude one |
| Income implausible (monthly entered as annual) | 4 | Never used in a rule; flag |
| Income missing | 4 | Never used in a rule; flag |
| Stale property value (before 2024) | 4 | Use as is; flag; advisor can edit |
| Mortgage not linked to a property | 4 | No home equity offer until linked; flag |
| Missing comfort zone | 4 | Not FastApp-eligible; flag |
| FastApp orphan (not in households) | 3 | Ignore; log |

Generated households also include natural rule cases: reverse mortgages (property ineligible), existing home equity loans (must be paid off by the new loan), investment properties, TX, VT and IA addresses, business and line-of-credit debt, and renters with no property.

## Pipeline rules (simplified)

- Interest each month = balance x APR / 12. Payments fixed. No fees. New loans amortise over their term.
- Plans keep paying at least today's total; freed money goes to the next target (avalanche: highest rate; snowball: smallest balance).
- Eligibility, CLTV bands, max and min loans as in the brief. Loans pay off unsecured debts with a higher rate than the loan, highest rate first, each in full.
- **Payment alert:** compares a plan's monthly payment with what the household pays today (source data plus the advisor's confirmed corrections; recurring extras count, one-off lump sums don't). Up to +10%: `none`. +10% to +25%: `amber`. Above +25%: `red`. Alerts never hide, filter or block a plan.
- **Nightly best plan:** most months saved vs the current path. Ties within 1 month: less interest, then lower contractual payment, then less risk (no loan, then unsecured, then secured). The referral is never an input. Shown as is, with its payment alert.
- **Advisor's plan (case):** the tool suggests by the same rule across every scenario the advisor builds, alerts included. Each scenario shows its own alert. The advisor may recommend any scenario; recommending one with an alert requires acknowledging it (logged as `payment_alert_acknowledged`).
- 600 months = "never". A household whose current path never ends shows `months_saved = from never` and ranks at the top.

## Cooling-off rules (assumption)

There's no published standard for how often a household can be offered a debt restructuring, so these come from nearby benchmarks: quarterly contact is the most common advisor rhythm, FICO counts a hard credit check for 12 months, and Fannie Mae requires 12 months before a cash-out refinance of an existing mortgage.

| Last offer | No proactive offer for | Then |
| --- | --- | --- |
| Presented, declined or undecided | 90 days | Ready |
| Agreed, no new loan | 90 days | Progress check due (not a new offer) |
| Agreed with a new loan | 365 days | Ready |
| Household request, or servicing call with no offer | No waiting period | Date still recorded |

Waiting periods limit outreach only. A household request or a booked servicing call is never blocked, and the advisor can override with a logged reason. If several offers overlap, the latest end date applies.

The source data doesn't know about agreed loans until the lender funds them, so the pipeline can still show a household that just agreed a loan (for example H01, agreed 2026-09-04) as an opportunity. The waiting status (until 2027-09-04) is what keeps it off the outreach list.

## Payment alerts in the demo data

- 88 of 299 nightly best plans carry an alert (81 red, 7 amber), mostly short-term FastApp loans. Example: H11's nightly best, FastApp 1-year, raises $1,562 to $4,548 a month (+191%, red).
- 59 of 278 advisor scenarios carry an alert (44 red, 15 amber). Recurring extra payments count toward the alert; one-off lump sums don't.
- In cases where the suggested plan alerts, the advisor usually switches to a plan without one. H11's advisor picks FastApp 3-year at $1,265 against the case's confirmed $1,182 (+7%, no alert). 9 cases recommend a plan with a red alert, each acknowledged and logged with a reason, to test that path.
- The opportunity list ranks by the nightly best plan's months saved, so a household can rank high on a plan with a red alert. The alert shows on the row.

## Known limits

- `scenario_results.csv` applies debt-level edits (payment, rate, excluded duplicate) and extra payments. Edits to property value, FICO, mortgage link or comfort zone are recorded in `case_overrides.csv` but do not re-run eligibility here; the tool should re-check eligibility when they change.
- Names, addresses and lenders are fictional.

## Regenerate

```
python3 scripts/generate.py <folder with the 6 sample CSVs> data
python3 scripts/pipeline.py data
python3 scripts/advisor_inputs.py data
python3 scripts/cadence.py data
```
