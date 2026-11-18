"""Generate advisor-built simulation inputs (what advisors learn on calls) and score them.

Usage: python3 advisor_inputs.py <data_dir>   (run after generate.py and pipeline.py)
Writes cases.csv, case_history.csv, scenarios.csv, extra_payments.csv, case_overrides.csv,
custom_loans.csv and scenario_results.csv.
Plan month 1 = 2026-12. Months in inputs are YYYY-MM.
"""
import csv, os, sys, random
from collections import defaultdict

D = sys.argv[1]
rng = random.Random(7)
CAP = 600


def read(n):
    with open(os.path.join(D, n), newline='') as fh:
        return list(csv.DictReader(fh))


def write(n, rows, cols=None):
    with open(os.path.join(D, n), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=cols or list(rows[0]))
        w.writeheader(); w.writerows(rows)


H = {h['household_id']: h for h in read('households.csv')}
DEBTS = read('debts.csv'); PROPS = read('properties.csv'); MEM = read('household_members.csv')
RES = {r['household_id']: r for r in read('pipeline_results.csv')}
OFF = defaultdict(list)
for o in read('pipeline_offers.csv'): OFF[o['household_id']].append(o)
FLAGS = defaultdict(list)
for f in read('pipeline_flags.csv'): FLAGS[f['household_id']].append(f)
by_h = defaultdict(list)
for d in DEBTS:
    for k in ('balance', 'rate', 'monthly_payment'): d[k] = float(d[k])
    by_h[d['household_id']].append(d)


def month_index(ym):  # '2026-12' -> 1
    y, m = map(int, ym.split('-'))
    return (y - 2026) * 12 + (m - 12) + 1


def ym(i):
    t = 11 + i  # 1 -> Dec 2026
    return f"{2026 + (t - 1) // 12}-{(t - 1) % 12 + 1:02d}"


def amort(P, r, n):
    i = r / 1200
    return P / n if i == 0 else P * i / (1 - (1 + i) ** -n)


def simulate(debts, strategy, budget, extras):
    """extras: list of (type, amount, start_idx, end_idx)."""
    d = [[i, b, r, p] for i, b, r, p in debts if b > 0]
    tot, m = 0.0, 0
    while d and m < CAP:
        m += 1
        for x in d:
            it = x[1] * x[2] / 1200; x[1] += it; tot += it
        spent = 0.0
        for x in d:
            pay = min(x[3], x[1]); x[1] -= pay; spent += pay
        extra = sum(a for t, a, s, e in extras if (t == 'one_off' and s == m) or
                    (t == 'recurring' and s <= m and (e is None or m <= e)))
        left = (budget - spent if strategy != 'current' else 0) + extra
        while left > 0.005:
            act = [x for x in d if x[1] > 0.005]
            if not act: break
            t = max(act, key=lambda x: x[2]) if strategy in ('avalanche', 'current') else min(act, key=lambda x: x[1])
            pay = min(left, t[1]); t[1] -= pay; left -= pay
        d = [x for x in d if x[1] > 0.005]
    return (None if d else m), round(tot)


# ---------- pick cased households: all flagged sample ones + top opportunities + random ----------
must = ['H01', 'H07', 'H08', 'H09', 'H11', 'H15', 'H16', 'H04', 'H12']
ranked = sorted(RES.values(), key=lambda r: int(r['advisor_rank']))
pool = [r['household_id'] for r in ranked if r['household_id'] not in must]
top = [hid for hid in pool if int(RES[hid]['advisor_rank']) <= 12]
rest = [hid for hid in pool if hid not in top]
cased = must + top + rng.sample(rest, 25)
STATUS = [('in_progress', 30), ('proposed', 22), ('agreed', 33), ('declined', 10), ('undecided', 5)]


def wpick(p):
    x = rng.uniform(0, sum(w for _, w in p))
    for v, w in p:
        x -= w
        if x <= 0: return v
    return p[-1][0]


cases, history, scenarios, extras_out, overrides, customs, results = [], [], [], [], [], [], []
fixed_status = {'H01': 'agreed', 'H07': 'proposed', 'H09': 'in_progress', 'H12': 'declined'}
for n, hid in enumerate(cased, 1):
    h = H[hid]; adv = h['advisor']; cid = f"C{n:04d}"
    status = fixed_status.get(hid) or wpick(STATUS)
    day = rng.randint(1, 28)
    mon = rng.choice(["09", "10", "11"])
    created = f"2026-{mon}-{(day if mon != '11' else min(day, 13)):02d}"  # data snapshot is 2026-11-14
    debts = {d['debt_id']: dict(d) for d in by_h[hid]}
    ov_fields = {}
    hist = [('case_created', '')]

    # ---- overrides for flagged data (what the household tells the advisor) ----
    def override(etype, eid, field, src, new, reason, report=True):
        oid = f"O{len(overrides) + 1:04d}"
        overrides.append(dict(override_id=oid, case_id=cid, household_id=hid, entity_type=etype, entity_id=eid,
                              field=field, source_value=src, override_value=new, reason=reason,
                              reported_to_backend=report, changed_by=adv, changed_at=created))
        hist.append(('override', oid))
    for f in FLAGS[hid]:
        e = f['entity_id']
        if f['flag'] == 'payment_below_interest':
            d = debts[e]; new = round(d['balance'] * (d['rate'] / 1200 + 0.02))
            override('debt', e, 'monthly_payment', int(d['monthly_payment']), new,
                     'Household confirmed their actual monthly payment')
            d['monthly_payment'] = new
        elif f['flag'] == 'zero_rate':
            d = debts[e]
            override('debt', e, 'rate', 0.0, 22.99, 'Promotional rate ended; household confirmed 22.99%')
            d['rate'] = 22.99
        elif f['flag'] == 'possible_duplicate':
            a, b = e.split(';')
            override('debt', b, 'excluded', False, True, 'Household confirmed it is the same card listed twice')
            debts.pop(b, None)
        elif f['flag'] == 'stale_property_value':
            p = next(p for p in PROPS if p['property_id'] == e)
            new = round(float(p['value']) * rng.uniform(2.8, 3.6), -3)
            override('property', e, 'value', p['value'], int(new), 'Household shared a 2026 appraisal')
        elif f['flag'] == 'mortgage_unlinked':
            pid = next((p['property_id'] for p in PROPS if p['household_id'] == hid), '')
            if pid: override('debt', e, 'property_id', '', pid, 'Mortgage is on the household\'s home')
        elif f['flag'] == 'no_fico_any_member':
            m = next(m for m in MEM if m['household_id'] == hid)
            override('member', m['member_id'], 'fico', '', rng.randint(660, 780),
                     'Household shared a recent credit report', report=False)
        elif f['flag'] == 'missing_comfort_zone':
            override('household', hid, 'comfort_zone', '', 2, 'Advisor confirmed comfort zone 2')
    valid = [d for d in debts.values() if d['monthly_payment'] > 0]
    base = [(d['debt_id'], d['balance'], d['rate'], d['monthly_payment']) for d in valid]
    budget = sum(x[3] for x in base)
    today_pay = budget  # what the household confirms it pays today (source data + case edits)

    # ---- extra payments the household volunteers ----
    ex_ids, ex_list = [], []
    if hid == 'H01' or rng.random() < 0.6:
        kinds = [('one_off', 'Annual bonus in April')] if hid == 'H01' else rng.sample(
            [('one_off', 'Annual bonus in April'), ('recurring', 'Raise from September'),
             ('one_off', 'Savings used to pay down debt upfront'), ('recurring', 'Spare cash each month'),
             ('one_off', 'Tax refund in March')], rng.choice([1, 1, 2]))
        for t, why in kinds:
            if 'April' in why: start = '2027-04'
            elif 'September' in why: start = '2027-09'
            elif 'March' in why: start = '2027-03'
            elif 'upfront' in why: start = '2026-12'
            else: start = '2027-01'
            amt = (5000 if hid == 'H01' else rng.choice([2000, 3000, 5000, 8000, 12000])) if t == 'one_off' \
                else rng.choice([100, 150, 200, 300, 400, 500])
            eid = f"E{len(extras_out) + 1:04d}"
            extras_out.append(dict(extra_id=eid, case_id=cid, household_id=hid, type=t, amount=amt,
                                   start_month=start, end_month='', reason=why))
            ex_ids.append(eid); ex_list.append((t, amt, month_index(start), None))
            hist.append(('extra_payment_added', eid))

    # ---- custom loan (a loan not in the catalogue) ----
    custom = None
    if rng.random() < 0.12 and hid not in ('H01',):
        custom = dict(custom_loan_id=f"L{len(customs) + 1:03d}", case_id=cid, household_id=hid,
                      lender_name=rng.choice(['Local credit union', 'Employer credit union', 'Bank relationship loan']),
                      rate=round(rng.uniform(8.0, 11.5), 2), term_months=rng.choice([36, 48, 60]),
                      max_amount=rng.choice([25000, 40000, 60000]), note='Household asked to compare this offer')
        customs.append(custom); hist.append(('custom_loan_added', custom['custom_loan_id']))

    # ---- scenarios ----
    def add_scn(name, strategy, src, product='', term='', amount=0, paid=(), rate=None, extras=()):
        sid = f"S{len(scenarios) + 1:04d}"
        moved = set(paid)
        debts_s = [x for x in base if x[0] not in moved]
        if amount:
            lp = amort(amount, rate, int(term)); debts_s.append(('NEW_LOAN', amount, rate, lp))
        contractual = sum(x[3] for x in debts_s)
        exl = [x for x, i in zip(ex_list, ex_ids) if i in extras]
        mo, it = simulate(debts_s, strategy, max(budget, contractual), exl)
        scenarios.append(dict(scenario_id=sid, case_id=cid, household_id=hid, name=name, strategy=strategy,
                              loan_source=src, product=product, term_months=term, loan_amount=round(amount),
                              loan_rate=rate if rate is not None else '', debts_paid_off=';'.join(paid),
                              extra_payment_ids=';'.join(extras), created_by=adv, is_recommended=False, advisor_reason=''))
        pay = max(budget, contractual)
        # rule 7: required monthly = contractual payments + recurring extras (one-off lump sums excluded)
        required = contractual + sum(x[1] for x in exl if x[0] == 'recurring')
        chg = max(pay, required) / today_pay - 1 if today_pay else 0
        alert = 'none' if chg <= 0.10 else ('amber' if chg <= 0.25 else 'red')
        results.append(dict(scenario_id=sid, case_id=cid, household_id=hid,
                            months_to_debt_free=mo if mo else 'never', total_interest=it,
                            monthly_payment=round(pay), contractual_monthly=round(contractual),
                            required_monthly=round(max(pay, required)), today_monthly=round(today_pay), payment_change_pct=round(chg * 100, 1),
                            payment_alert=alert))
        hist.append(('scenario_added', sid))
        if alert != 'none':
            hist.append((f'payment_alert_shown_{alert}', sid))
        return sid

    sids = [add_scn('Avalanche (edited data)', 'avalanche', 'none')]
    key = lambda o: (int(o['months_to_debt_free']) if o['months_to_debt_free'] != 'never' else 10 ** 6,
                     float(o['total_interest']), float(o['contractual_monthly']), o['security'] == 'secured')
    offers = sorted(OFF[hid], key=key)
    calm_offers = [o for o in offers if o['payment_alert'] == 'none']

    def offer_scn(o, label, extras=()):
        paid = [p for p in o['debts_paid_off'].split(';') if p in debts]
        amt = sum(debts[p]['balance'] for p in paid)
        yrs = int(o['term_months']) // 12
        return add_scn(f"{o['product']} {yrs}-yr{label}", 'avalanche', 'product', o['product'],
                       o['term_months'], amt, paid, float(o['rate']), extras)
    # 1. the pipeline's best offer, as shown on the list (may raise the payment -> alert in the workspace)
    if offers:
        sids.append(offer_scn(offers[0], ' (nightly best)'))
    # 2. after an alert, the advisor tries the fastest offer that keeps the payment within 10%
    if calm_offers and (not offers or calm_offers[0] is not offers[0]):
        sids.append(offer_scn(calm_offers[0], ''))
    # 3. the household adds facts on the call (bonus, raise, savings)
    if ex_ids:
        base_o = calm_offers[0] if calm_offers else None
        sids.append(offer_scn(base_o, ' + extras', ex_ids) if base_o else
                    add_scn('Avalanche + extras', 'avalanche', 'none', extras=ex_ids))
    if custom:
        cand = sorted([d for d in valid if not d['property_id'] and d['rate'] > custom['rate']], key=lambda d: -d['rate'])
        paid, amt = [], 0
        for d in cand:
            if amt + d['balance'] <= custom['max_amount']: paid.append(d['debt_id']); amt += d['balance']
        if paid:
            sids.append(add_scn(f"{custom['lender_name']} {custom['term_months'] // 12}-yr", 'avalanche', 'custom',
                                custom['custom_loan_id'], custom['term_months'], amt, paid, custom['rate']))

    # ---- the tool SUGGESTS by rule 7 over every scenario, alerts included (nothing is filtered out);
    # ---- the ADVISOR chooses, and must acknowledge any payment alert on the plan they recommend.
    risk = {'none': 0, 'custom': 1, 'product': 2}
    rs = [(s, r) for s, r in zip(scenarios, results) if s['case_id'] == cid]
    mv = lambda r: int(r['months_to_debt_free']) if r['months_to_debt_free'] != 'never' else 10 ** 6
    fastest = min(mv(r) for _, r in rs)
    suggested = min([(s, r) for s, r in rs if mv(r) - fastest <= 1],
                    key=lambda sr: (sr[1]['total_interest'], sr[1]['contractual_monthly'], risk[sr[0]['loan_source']]))
    rec, rec_r = suggested
    reason = 'Tool suggestion (fastest plan)'
    calm = [sr for sr in rs if sr[1]['payment_alert'] == 'none']
    if suggested[1]['payment_alert'] != 'none':
        if calm and rng.random() < 0.8:
            rec, rec_r = min(calm, key=lambda sr: (mv(sr[1]), sr[1]['total_interest']))
            reason = 'Payment alert on the fastest plan; household chose a plan that keeps today\'s payment'
        else:
            reason = 'Household accepted the higher payment after the alert (new income confirmed on call)'
    elif len(rs) > 1 and rng.random() < 0.15:
        cheaper = [sr for sr in calm if sr[1]['contractual_monthly'] < suggested[1]['contractual_monthly'] - 50]
        if cheaper:
            rec, rec_r = min(cheaper, key=lambda sr: sr[1]['contractual_monthly'])
            reason = 'Household preferred a lower contractual monthly payment over the fastest plan'
    rec['advisor_reason'] = reason
    if status != 'in_progress':
        rec['is_recommended'] = True
        if rec_r['payment_alert'] != 'none':
            hist.append(('payment_alert_acknowledged', rec['scenario_id']))
        hist.append(('recommended', rec['scenario_id']))
    if status in ('proposed', 'agreed', 'declined', 'undecided'):
        hist.append(('presented', rec['scenario_id']))
    decision = status if status in ('agreed', 'declined', 'undecided') else ''
    if decision:
        hist.append((f'decision_{decision}', rec['scenario_id']))
        if decision == 'agreed': hist.append(('snapshot_frozen', rec['scenario_id']))
    cases.append(dict(case_id=cid, household_id=hid, advisor=adv, branch=h['branch'], status=status,
                      created_at=created, updated_at=created, version=1 + sum(1 for e, _ in hist if e == 'override'),
                      recommended_scenario_id=rec['scenario_id'] if rec['is_recommended'] else '',
                      recommended_payment_alert=rec_r['payment_alert'] if rec['is_recommended'] else '',
                      payment_alert_acknowledged=rec['is_recommended'] and rec_r['payment_alert'] != 'none',
                      tool_suggested_scenario_id=suggested[0]['scenario_id'],
                      recommendation_differs_from_suggestion=rec is not suggested[0] and rec['is_recommended'],
                      decision=decision, decision_at=created if decision else ''))
    for k, (ev, ref) in enumerate(hist, 1):
        history.append(dict(case_id=cid, seq=k, event=ev, ref_id=ref, by=adv, at=created))

write('cases.csv', cases)
write('case_history.csv', history)
write('scenarios.csv', scenarios)
write('scenario_results.csv', results)
write('extra_payments.csv', extras_out)
write('case_overrides.csv', overrides)
write('custom_loans.csv', customs)
print('cases', len(cases), 'scenarios', len(scenarios), 'extras', len(extras_out), 'overrides', len(overrides),
      'custom loans', len(customs))
