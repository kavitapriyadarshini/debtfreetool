"""Contact history and outreach cooling-off for the Debt Free tool.

Usage: python3 cadence.py <data_dir>   (run after advisor_inputs.py)
Writes contact_history.csv (one row per contact) and household_outreach.csv (one row per household).

Cooling-off rules (assumptions, see README):
  plan presented, declined or undecided      -> 90 days
  plan agreed, no new loan                   -> 90 days, then a progress check (not a new offer)
  plan agreed with a new loan                -> 365 days before any new restructuring offer
  household request / servicing call without an offer -> no waiting period (date still recorded)
The waiting period limits proactive outreach only. Household requests and booked servicing calls
are never blocked; an advisor may override with a logged reason.
"""
import csv, os, sys, random
from datetime import date, timedelta

D = sys.argv[1]
AS_OF = date(2026, 11, 14)  # data snapshot
rng = random.Random(11)
GAP = {'declined': 90, 'undecided': 90, 'agreed_no_loan': 90, 'agreed_loan': 365, 'presented': 90}


def read(n):
    with open(os.path.join(D, n), newline='') as fh:
        return list(csv.DictReader(fh))


def write(n, rows):
    with open(os.path.join(D, n), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)


H = read('households.csv'); CASES = read('cases.csv')
SC = {s['scenario_id']: s for s in read('scenarios.csv')}
contacts = []


def add(hid, adv, d, channel, initiated_by, offer, outcome, case_id='', scenario_id='', override_reason=''):
    contacts.append(dict(contact_id=f"K{len(contacts) + 1:05d}", household_id=hid, advisor=adv, contacted_at=d.isoformat(),
                         channel=channel, initiated_by=initiated_by, plan_presented=offer, outcome=outcome,
                         includes_new_loan='', case_id=case_id, scenario_id=scenario_id,
                         inside_cooling_off_override_reason=override_reason))
    return contacts[-1]


# 1. contacts that come from this season's cases (presented plans)
cased = set()
for c in CASES:
    cased.add(c['household_id'])
    if c['status'] == 'in_progress':
        continue  # still casing: no contact yet
    d = date.fromisoformat(c['decision_at'] or c['updated_at'])
    outcome = c['decision'] or 'presented'
    k = add(c['household_id'], c['advisor'], d, rng.choice(['servicing_call', 'servicing_call', 'advisor_outreach']),
            'advisor', True, outcome, c['case_id'], c['recommended_scenario_id'])
    k['includes_new_loan'] = SC[c['recommended_scenario_id']]['loan_source'] != 'none'

# 2. older history for the rest of the book, so every rule is exercised both inside and past its window
for h in H:
    hid, adv = h['household_id'], h['advisor']
    for _ in range(rng.choice([0, 1, 1, 2])):  # routine servicing calls with no debt offer
        add(hid, adv, AS_OF - timedelta(days=rng.randint(10, 420)), 'servicing_call', 'advisor', False, 'no_offer')
    if hid in cased:
        continue
    r = rng.random()
    if r < 0.06:    # agreed a loan plan last year: some still waiting, some ready again
        k = add(hid, adv, AS_OF - timedelta(days=rng.choice([150, 240, 330, 400, 470])), 'servicing_call', 'advisor',
                True, 'agreed')
        k['includes_new_loan'] = True
    elif r < 0.12:  # agreed a no-loan plan
        k = add(hid, adv, AS_OF - timedelta(days=rng.choice([30, 60, 120, 200])), 'servicing_call', 'advisor',
                True, 'agreed')
        k['includes_new_loan'] = False
    elif r < 0.20:  # declined or undecided
        add(hid, adv, AS_OF - timedelta(days=rng.choice([20, 45, 80, 100, 160])), 'advisor_outreach', 'advisor',
            True, rng.choice(['declined', 'declined', 'undecided']))
    elif r < 0.24:  # household asked about their debt
        add(hid, adv, AS_OF - timedelta(days=rng.randint(5, 60)), 'household_request', 'household', False, 'no_offer')

# 3. two overrides: advisor contacted inside a waiting period, with a logged reason
waiting_hids = [k['household_id'] for k in contacts if k['plan_presented'] and k['outcome'] == 'declined'
                and (AS_OF - date.fromisoformat(k['contacted_at'])).days > 30][:2]
for hid, why in zip(waiting_hids, ['Household received a large bonus and asked to revisit',
                                   'Rate on the household\'s card rose sharply; advisor flagged a better option']):
    adv = next(h['advisor'] for h in H if h['household_id'] == hid)
    add(hid, adv, AS_OF - timedelta(days=4), 'advisor_outreach', 'advisor', True, 'undecided', override_reason=why)

contacts.sort(key=lambda k: (k['household_id'], k['contacted_at']))


def gap_for(k):
    if not k['plan_presented'] in (True, 'True'):
        return 0
    if k['outcome'] == 'agreed':
        return GAP['agreed_loan'] if k['includes_new_loan'] in (True, 'True') else GAP['agreed_no_loan']
    return GAP.get(k['outcome'], 90)


rows = []
for h in H:
    hid = h['household_id']
    ks = [k for k in contacts if k['household_id'] == hid]
    last = max(ks, key=lambda k: k['contacted_at']) if ks else None
    offers = [k for k in ks if k['plan_presented'] in (True, 'True')]
    # the binding window is the latest end date across all offers (an agreed loan outlasts a later decline)
    ends = [(date.fromisoformat(k['contacted_at']) + timedelta(days=gap_for(k)), k) for k in offers]
    end, src = max(ends, key=lambda e: e[0]) if ends else (None, None)
    waiting = end is not None and end > AS_OF
    if waiting:
        status = 'waiting'
    elif src is not None and src['outcome'] == 'agreed':
        status = 'progress_check_due' if src['includes_new_loan'] in (False, 'False') else 'ready'
    else:
        status = 'ready'
    rows.append(dict(
        household_id=hid, advisor=h['advisor'],
        last_contacted_at=last['contacted_at'] if last else '',
        days_since_last_contact=(AS_OF - date.fromisoformat(last['contacted_at'])).days if last else '',
        last_contact_channel=last['channel'] if last else '',
        last_offer_at=offers[-1]['contacted_at'] if offers else '',
        last_offer_outcome=offers[-1]['outcome'] if offers else '',
        last_offer_included_loan=offers[-1]['includes_new_loan'] if offers else '',
        cooling_off_rule=('agreed_loan_365d' if src and src['outcome'] == 'agreed' and src['includes_new_loan'] in (True, 'True')
                          else 'agreed_no_loan_90d' if src and src['outcome'] == 'agreed'
                          else f"{src['outcome']}_90d" if src else ''),
        eligible_for_outreach_from=end.isoformat() if end else '',
        days_until_eligible=(end - AS_OF).days if waiting else 0,
        outreach_status=status))

write('contact_history.csv', contacts)
write('household_outreach.csv', rows)
from collections import Counter
print('contacts', len(contacts), Counter(r['outreach_status'] for r in rows), Counter(r['cooling_off_rule'] for r in rows))
