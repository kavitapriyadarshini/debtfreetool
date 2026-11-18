"""Nightly pipeline (simplified) for the Debt Free tool.

Usage: python3 pipeline.py <data_dir>
Reads the source CSVs, applies the data handling rules, builds every eligible loan offer,
simulates current path / avalanche / snowball / loan plans, and picks the best plan per
household. Writes pipeline_offers.csv, pipeline_results.csv and pipeline_flags.csv.

Simplifications: interest = balance x APR / 12 each month; payments fixed; no fees;
new loans fully amortising; plans keep paying at least today's total; 600-month cap = never.
"""
import csv, os, sys
from collections import defaultdict

D = sys.argv[1]
CAP = 600


def read(n):
    with open(os.path.join(D, n), newline='') as fh:
        return list(csv.DictReader(fh))


H = read('households.csv'); M = read('household_members.csv'); DEBTS = read('debts.csv')
P = read('properties.csv'); FA = {r['household_id'] for r in read('fastapp_list.csv')}
PROD = read('loan_products.csv')

for d in DEBTS:
    d['balance'] = float(d['balance']); d['rate'] = float(d['rate']); d['monthly_payment'] = float(d['monthly_payment'])
for p in P:
    p['value'] = float(p['value'])

by_h = defaultdict(list)
for d in DEBTS: by_h[d['household_id']].append(d)
props_h = defaultdict(list)
for p in P: props_h[p['household_id']].append(p)
mem_h = defaultdict(list)
for m in M: mem_h[m['household_id']].append(m)

FASTAPP_MAX = {'1': 50000, '2': 150000, '3': 300000}
YELLOW = [(740, .85, .75), (720, .80, .70), (680, .75, .65), (660, .70, .60), (640, .60, .50)]
PINK = [(740, .90, .75), (720, .90, .75), (680, .85, .70)]
SPEC = {
    'FastApp': dict(kind='unsecured', min=10000),
    'HELOAN Yellow': dict(kind='secured', min=25000, excluded={'TX'}, bands=YELLOW),
    'HELOAN Pink': dict(kind='secured', min=20000, excluded={'TX', 'VT', 'IA'}, bands=PINK),
}
RISK = {'none': 0, 'unsecured': 1, 'secured': 2}


def amort(Pv, rate, n):
    i = rate / 1200
    return Pv / n if i == 0 else Pv * i / (1 - (1 + i) ** -n)


def simulate(debts, strategy, budget=None):
    """debts: list of (id, bal, rate, pay). Returns months (None = never), interest, payoff order."""
    d = [[i, b, r, p] for i, b, r, p in debts if b > 0]
    if not d:
        return 0, 0.0, []
    total, order, m = 0.0, [], 0
    budget = budget if budget is not None else sum(x[3] for x in d)
    while d and m < CAP:
        m += 1
        for x in d:
            it = x[1] * x[2] / 1200; x[1] += it; total += it
        spent = 0.0
        for x in d:
            pay = min(x[3], x[1]); x[1] -= pay; spent += pay
        if strategy != 'current':
            left = budget - spent
            while left > 0.005:
                act = [x for x in d if x[1] > 0.005]
                if not act: break
                t = max(act, key=lambda x: x[2]) if strategy == 'avalanche' else min(act, key=lambda x: x[1])
                pay = min(left, t[1]); t[1] -= pay; left -= pay
        for x in [x for x in d if x[1] <= 0.005]:
            order.append(x[0])
        d = [x for x in d if x[1] > 0.005]
    return (None if d else m), round(total), order


def alert(rise):
    """Payment alert vs today's total monthly payment. Alerts only; never filters a plan out."""
    return 'none' if rise <= 0.10 else ('amber' if rise <= 0.25 else 'red')


def blended(debts):
    tot = sum(b for _, b, _, _ in debts)
    return sum(b * r for _, b, r, _ in debts) / tot if tot else 0


results, offers_out, flags_out = [], [], []
for h in H:
    hid = h['household_id']
    flags = []
    debts = by_h[hid]
    valid, excluded = [], []
    for d in debts:
        if d['monthly_payment'] <= 0:
            excluded.append(d); flags.append(('zero_payment', d['debt_id']))
            continue
        valid.append(d)
        if d['rate'] == 0:
            flags.append(('zero_rate', d['debt_id']))
        if d['monthly_payment'] < d['balance'] * d['rate'] / 1200:
            flags.append(('payment_below_interest', d['debt_id']))
    seen = {}
    for d in valid:
        k = (d['debt_name'], d['balance'], d['rate'], d['monthly_payment'])
        if k in seen: flags.append(('possible_duplicate', f"{seen[k]};{d['debt_id']}"))
        else: seen[k] = d['debt_id']
    scores = [int(m['fico']) for m in mem_h[hid] if m['fico']]
    fico_default = not scores
    fico = 740 if fico_default else min(scores)
    if fico_default: flags.append(('no_fico_any_member', ''))
    cz = h['comfort_zone']
    if not cz: flags.append(('missing_comfort_zone', ''))
    inc = h['annual_income']
    pay_total = sum(d['monthly_payment'] for d in valid)
    if not inc: flags.append(('income_missing', ''))
    elif pay_total * 12 > float(inc): flags.append(('income_implausible', ''))
    for p in props_h[hid]:
        if p['value_as_of'] < '2024-01-01': flags.append(('stale_property_value', p['property_id']))
    for d in valid:
        if d['debt_type'] in ('Mortgage', 'Home equity loan') and not d['property_id']:
            flags.append(('mortgage_unlinked', d['debt_id']))

    base = [(d['debt_id'], d['balance'], d['rate'], d['monthly_payment']) for d in valid]
    cur = simulate(base, 'current'); ava = simulate(base, 'avalanche'); snb = simulate(base, 'snowball')

    # ---- loan offers ----
    candidates = []  # (product, property_id, kind, limit, rate, term, mandatory)
    unsecured = sorted([d for d in valid if not d['property_id'] and d['debt_type'] not in
                        ('Mortgage', 'Home equity loan', 'Reverse mortgage')], key=lambda d: -d['rate'])
    for r in PROD:
        prod, term, rate = r['product'], int(r['term_months']), float(r['rate'])
        spec = SPEC.get(prod)
        if spec is None:
            continue
        if spec['kind'] == 'unsecured':
            if hid in FA and cz and r['comfort_zone'] == cz:
                candidates.append((prod, '', 'unsecured', FASTAPP_MAX[cz], rate, term, []))
            continue
        if h['home_state'] in spec['excluded']:
            continue
        band = next((b for b in spec['bands'] if fico >= b[0]), None)
        if band is None:
            continue
        for p in props_h[hid]:
            on_p = [d for d in debts if d['property_id'] == p['property_id']]
            if any(d['debt_type'] == 'Reverse mortgage' for d in on_p): continue
            firsts = [d for d in on_p if d['debt_type'] == 'Mortgage']
            if not firsts: continue
            cltv = band[1] if p['property_type'] == 'Residence' else band[2]
            avail = p['value'] * cltv - sum(d['balance'] for d in firsts)
            if prod == 'HELOAN Yellow':
                cap = 350000 if (p['property_type'] == 'Investment' or fico < 680) else 500000
            else:
                cap = 750000
            limit = min(avail, cap)
            he = [d for d in on_p if d['debt_type'] == 'Home equity loan']
            candidates.append((prod, p['property_id'], 'secured', limit, rate, term, he))

    best_offer = None
    for prod, pid, kind, limit, rate, term, mandatory in candidates:
        if limit <= 0: continue
        chosen, amt = [], 0.0
        for d in mandatory:
            chosen.append(d); amt += d['balance']
        if amt > limit: continue
        for d in unsecured:
            if d['rate'] > rate and amt + d['balance'] <= limit:
                chosen.append(d); amt += d['balance']
        if amt < SPEC[prod]['min'] or not chosen: continue
        moved = {d['debt_id'] for d in chosen}
        if blended([x for x in base if x[0] not in moved] + [('LOAN', amt, rate, 0)]) >= blended(base): continue
        lp = amort(amt, rate, term)
        rest = [x for x in base if x[0] not in moved] + [('NEW_LOAN', amt, rate, lp)]
        contractual = sum(x[3] for x in rest)
        mo, it, order = simulate(rest, 'avalanche', budget=max(pay_total, contractual))
        rise = contractual / pay_total - 1 if pay_total else 0
        afford = alert(rise)
        o = dict(household_id=hid, product=prod, property_id=pid, security=kind, term_months=term, rate=rate,
                 max_available=round(limit), loan_amount=round(amt), debts_paid_off=';'.join(d['debt_id'] for d in chosen),
                 loan_payment=round(lp), contractual_monthly=round(contractual), payment_change_pct=round(rise * 100, 1),
                 payment_alert=afford, months_to_debt_free=mo if mo else 'never', total_interest=it)
        offers_out.append(o)
        key = ((mo or 10 ** 6), it, contractual, RISK[kind])
        # The pipeline picks its best plan exactly as the brief describes and never filters on payment.
        # A payment rise is raised as an alert on the plan (S1 list, S3 workspace), not used to drop it.
        if best_offer is None or key < best_offer[0]:
            best_offer = (key, o)

    # ---- best plan: months first; ties within 1 month -> interest, contractual payment, risk ----
    plans = [('Current path', cur[0], cur[1], pay_total, 'none'),
             ('Avalanche', ava[0], ava[1], pay_total, 'none'),
             ('Snowball', snb[0], snb[1], pay_total, 'none')]
    if best_offer:
        o = best_offer[1]
        plans.append((f"{o['product']} {o['term_months']}m", best_offer[0][0] if best_offer[0][0] < 10 ** 6 else None,
                      o['total_interest'], o['contractual_monthly'], o['security']))
    mval = lambda x: x if x is not None else 10 ** 6
    fastest = min(mval(p[1]) for p in plans)
    tied = [p for p in plans if mval(p[1]) - fastest <= 1]
    best = min(tied, key=lambda p: (p[2], p[3], RISK[p[4]]))
    cur_m = mval(cur[0])
    if cur[0] is None:
        saved = 'from never' if best[1] is not None else 0
    else:
        saved = cur_m - mval(best[1])
    status = 'no_action_needed' if (best[0] == 'Current path' or saved == 0) else 'opportunity'
    pre_no_offer = hid in FA and not any(o['household_id'] == hid and o['product'] == 'FastApp' for o in offers_out)
    results.append(dict(
        household_id=hid, advisor=h['advisor'], branch=h['branch'], fico_used=fico, fico_defaulted=fico_default,
        valid_debts=len(valid), excluded_debts=len(excluded), total_balance=round(sum(x[1] for x in base)),
        current_monthly=round(pay_total), current_months=cur[0] or 'never', current_interest=cur[1],
        avalanche_months=ava[0] or 'never', avalanche_interest=ava[1],
        snowball_months=snb[0] or 'never', snowball_interest=snb[1],
        offers=sum(1 for o in offers_out if o['household_id'] == hid),
        best_offer=(f"{best_offer[1]['product']} {best_offer[1]['term_months']}m" if best_offer else ''),
        best_plan=best[0], best_plan_months=best[1] or 'never', best_plan_interest=best[2],
        best_plan_monthly=round(max(best[3], pay_total)),
        best_plan_payment_change_pct=round((max(best[3], pay_total) / pay_total - 1) * 100, 1) if pay_total else 0,
        best_plan_payment_alert=alert(max(best[3], pay_total) / pay_total - 1) if pay_total else 'none',
        months_saved=saved,
        interest_saved=(cur[1] - best[2]) if cur[0] is not None else 'n/a',
        status=status, fastapp_preapproved_no_offer=bool(pre_no_offer),
        flags=';'.join(sorted({f for f, _ in flags}))))
    for f, e in flags:
        flags_out.append(dict(household_id=hid, entity_id=e, flag=f))

# rank opportunity within each advisor by months saved, then interest saved
for adv in {r['advisor'] for r in results}:
    rows = [r for r in results if r['advisor'] == adv]
    key = lambda r: (-(r['months_saved'] if isinstance(r['months_saved'], int) else (10 ** 4 if r['months_saved'] == 'from never' else -1)),
                     -(r['interest_saved'] if isinstance(r['interest_saved'], (int, float)) else 0))
    for i, r in enumerate(sorted(rows, key=key), 1):
        r['advisor_rank'] = i


def write(n, rows):
    with open(os.path.join(D, n), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)


write('pipeline_offers.csv', offers_out)
write('pipeline_results.csv', sorted(results, key=lambda r: (r['advisor'], r['advisor_rank'])))
write('pipeline_flags.csv', flags_out)
print('households', len(results), 'offers', len(offers_out), 'flags', len(flags_out))
