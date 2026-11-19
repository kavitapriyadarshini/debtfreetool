# Calculation engine: exact behaviour

SPEC.md says *what* the rules are. This file pins down *how* they are calculated, so the TypeScript engine reproduces the reference Python (`reference/pipeline.py`, `reference/advisor_inputs.py`, `reference/cadence.py`) and its outputs in `data/`. When this file and the Python disagree, the Python wins; when SPEC.md and the Python disagree, stop and flag it.

All money in dollars, rates as APR percent (24.99 = 24.99%). Demo "today" is fixed: **AS_OF = 2026-11-14**. Plan month 1 = December 2026.

## 1. Valid debts

- A debt with `monthly_payment <= 0` is **excluded** from every calculation (flag `zero_payment`). This includes reverse mortgages.
- Every other debt is valid, including 0% rates and payments below interest.
- Today's payment (`pay_total`) = sum of valid debts' monthly payments.

## 2. Simulation (one function for every plan)

Input: list of `[id, balance, rate, payment]` in **debt file order**, a strategy (`current` | `avalanche` | `snowball`), a budget, and optional extra payments.

Each month `m = 1, 2, …` while any balance > 0.005 and `m < 600`:
1. For every debt with balance > 0: `interest = balance * rate / 1200`; add it to the balance and to total interest.
2. For every debt: pay `min(payment, balance)`; sum what was paid as `spent`.
3. If strategy is not `current`: `left = budget - spent`. Otherwise `left = 0`.
4. Add extras due this month to `left`: a one-off whose start month index equals `m`, and every recurring extra whose start index ≤ `m`.
5. While `left > 0.005`: pick the target among debts with balance > 0.005. Avalanche (and `current` with extras) = highest rate; snowball = smallest balance. **Ties go to the first in list order.** Pay `min(left, balance)`.
6. Remove debts with balance ≤ 0.005; record them in payoff order.

Result: months (or **never** if any balance remains after 600 months), total interest rounded to the dollar, payoff order, and the month-by-month schedule (keep balances per debt per month for S4).

Month index of an extra: `'2026-12'` = 1, `'2027-01'` = 2, and so on.

## 3. Built-in plans

- **Current path:** strategy `current`, budget = `pay_total`.
- **Avalanche / snowball:** budget = `pay_total`.
- **Loan plan:** moved debts removed, new loan added as `['NEW_LOAN', amount, rate, amortised payment]`; strategy avalanche; budget = `max(pay_total, contractual)` where contractual = sum of the remaining payments including the new loan's.
- Amortised payment: `P * i / (1 - (1 + i)^-n)` with `i = rate / 1200`; if `i = 0`, `P / n`.

## 4. Eligibility and offers (one offer per product × term × property)

- Household FICO = lowest member score that exists; if none, **740** and flag `no_fico_any_member`.
- **FastApp:** household on `fastapp_list`, comfort zone present, and a product row whose `comfort_zone` equals it. Limit = 50,000 / 150,000 / 300,000 for zones 1 / 2 / 3. Unsecured.
- **HELOAN Yellow / Pink:** state not excluded (Yellow: TX; Pink: TX, VT, IA). FICO band (first band the score meets):
  - Yellow: 740 → 85% / 75% (residence / investment), 720 → 80/70, 680 → 75/65, 660 → 70/60, 640 → 60/50, below → none.
  - Pink: 740 → 90/75, 720 → 90/75, 680 → 85/70, below → none.
  - Per property: skip if any debt on it is a reverse mortgage, or it has no `Mortgage` debt linked. Available = `value * cltv - sum(Mortgage balances on it)`. Cap: Yellow 350,000 if investment or FICO < 680, else 500,000; Pink 750,000. Limit = `min(available, cap)`.
  - Existing `Home equity loan` debts on that property are **mandatory** payoffs and count toward the limit.
- **Debts a loan may pay off:** valid debts with no `property_id` and type not Mortgage, Home equity loan or Reverse mortgage, sorted by rate descending. Take each whose rate > loan rate if it fits fully within the remaining limit.
- Drop the offer if: limit ≤ 0, mandatory payoffs exceed the limit, amount < product minimum (FastApp 10,000; Yellow 25,000; Pink 20,000), nothing chosen, or the blended rate does not fall. Blended rate = balance-weighted average rate; compare the remaining debts plus the loan (at its rate) against all valid debts.
- Each offer records: amount, debts paid off, loan payment, contractual monthly, payment change % = `contractual / pay_total - 1`, payment alert, months, interest.

## 5. Best plan, ranking and status

- Best offer = lowest `(months, interest, contractual, risk)` with risk none 0 < unsecured 1 < secured 2. **No offer is filtered out for payment.**
- Candidates: current path, avalanche, snowball, best offer. Fastest = min months (never = 1,000,000). Tied = within 1 month of fastest. Best = lowest `(interest, contractual payment, risk)` among tied.
- Months saved = current months − best months. If the current path is never, months saved = `from never` (ranks first) and interest saved = `n/a`, because interest at the 600-month cap is not a real total. The UI shows both as "Not comparable" with a tooltip giving the best plan's debt-free time; never show the raw `from never` / `n/a` values.
- Status = `no_action_needed` if the best is the current path or months saved is 0; else `opportunity`.
- Payment alert on any plan: `rise = monthly / today - 1`; ≤ 10% none, ≤ 25% amber, else red. For the pipeline recommended plan, monthly = `max(contractual, pay_total)`. For advisor scenarios, monthly = `max(budget, contractual, contractual + recurring extras)` and today = the case-confirmed payment (after edits).
- **Suggestion inside a case (rule 6):** pick by the same order (fastest, then within 1 month less interest, lower contractual payment, less risk) **only among plans whose payment alert is none**. This supersedes the suggestion logic in `reference/advisor_inputs.py` and the `advisor_reason` text in `scenarios.csv`; don't test suggestions against those. Scenario results (months, interest, alerts) are unchanged and still must match.
- **Seeded scenario names:** 73 of the 93 seeded cases contain a scenario named "Avalanche (edited data)" although the case has no overrides. At load, a case with no overrides gets that scenario renamed "Avalanche", which makes it identical to the built-in avalanche, so it merges into the built-in column.
- Rank within advisor: months saved descending, then interest saved descending.

## 6. Flags

| Flag | Condition |
| --- | --- |
| `zero_payment` | monthly payment ≤ 0 |
| `zero_rate` | valid debt with rate 0 |
| `payment_below_interest` | payment < balance × rate / 1200 |
| `possible_duplicate` | two valid debts with identical name, balance, rate, payment |
| `no_fico_any_member` | no member has a score |
| `missing_comfort_zone` | comfort zone blank |
| `income_missing` | income blank |
| `income_implausible` | `pay_total * 12 > income` |
| `stale_property_value` | `value_as_of` before 2024-01-01 |
| `mortgage_unlinked` | Mortgage or Home equity loan with no `property_id` |

## 7. Waiting periods (`reference/cadence.py`)

Only contacts with `plan_presented = true` start a window: agreed with a new loan 365 days; agreed without a loan 90 days, then `progress_check_due`; presented, declined or undecided 90 days. The latest end date across all of a household's offers wins. Status: `waiting` if end date > AS_OF; else `progress_check_due` if the binding offer was an agreed no-loan plan; else `ready`.

## 8. Test fixtures (must pass)

| Fixture | What to compare |
| --- | --- |
| `data/pipeline_results.csv` | Per household: current, avalanche, snowball months and interest; best plan; months and interest saved; status; best plan monthly and payment alert; rank |
| `data/pipeline_offers.csv` | Every offer row and its numbers |
| `data/pipeline_flags.csv` | Every flag |
| `data/scenario_results.csv` | Every advisor scenario (with `case_overrides`, `extra_payments`, `custom_loans` applied) |
| `data/household_outreach.csv` | Outreach status and ready date |

Months must match exactly. Interest may differ by ±$1 (Python rounds half to even).
