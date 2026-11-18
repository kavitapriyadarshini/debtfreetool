"""Generate an extrapolated Debt Free dataset from the 16-household sample.

Usage: python3 generate.py <sample_dir> <out_dir>
Deterministic (seeded). Keeps the original 16 households unchanged and adds
generated households H17..H300 (H22 skipped so the sample's FastApp orphan stays an orphan).
"""
import csv, random, sys, os, math
from datetime import date

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
rng = random.Random(20261117)
TODAY = date(2026, 11, 14)

def read(name):
    for f in os.listdir(SRC):
        if f.endswith(name):
            with open(os.path.join(SRC, f), newline='') as fh:
                return list(csv.DictReader(fh))
    raise FileNotFoundError(name)

def amort(P, rate, n):
    i = rate / 1200
    return P / n if i == 0 else P * i / (1 - (1 + i) ** -n)

def r2(x, step=1):
    return int(round(x / step) * step)

households = read('households.csv')
members = read('household_members.csv')
debts = read('debts.csv')
properties = read('properties.csv')
fastapp = read('fastapp_list.csv')
products = read('loan_products.csv')

ADVISORS = {
    'Pamela Wilson': 'North Branch', 'Tom Brennan': 'North Branch',
    'Elena Duarte': 'South Branch', 'Priya Raman': 'South Branch', 'Marcus Webb': 'South Branch'}
for h in households:
    h['branch'] = ADVISORS[h['advisor']]
for d in debts:
    d.setdefault('origin', 'sample')

STATES = [('CA', 10), ('TX', 8), ('FL', 7), ('NY', 6), ('PA', 5), ('IL', 5), ('OH', 5), ('GA', 4), ('NC', 4),
          ('MI', 4), ('NJ', 4), ('VA', 3), ('WA', 3), ('AZ', 3), ('MA', 3), ('CO', 3), ('MN', 2), ('IA', 3),
          ('VT', 2), ('OR', 2), ('TN', 2), ('MO', 2), ('WI', 2), ('NV', 2)]
CITIES = {'CA': 'Sacramento', 'TX': 'Austin', 'FL': 'Tampa', 'NY': 'Albany', 'PA': 'Harrisburg', 'IL': 'Peoria',
          'OH': 'Dayton', 'GA': 'Savannah', 'NC': 'Durham', 'MI': 'Lansing', 'NJ': 'Trenton', 'VA': 'Richmond',
          'WA': 'Tacoma', 'AZ': 'Tempe', 'MA': 'Worcester', 'CO': 'Boulder', 'MN': 'Duluth', 'IA': 'Ames',
          'VT': 'Montpelier', 'OR': 'Eugene', 'TN': 'Knoxville', 'MO': 'Columbia', 'WI': 'Madison', 'NV': 'Reno'}
FIRST = ['James', 'Maria', 'Robert', 'Aisha', 'Michael', 'Chen', 'David', 'Fatima', 'Daniel', 'Olivia', 'Carlos',
         'Emily', 'Hiroshi', 'Grace', 'Samuel', 'Leah', 'Omar', 'Hannah', 'Victor', 'Nina', 'Ethan', 'Priya',
         'Lucas', 'Sara', 'Noah', 'Zoe', 'Isaac', 'Mei', 'Owen', 'Rosa', 'Caleb', 'Ana', 'Felix', 'Ruth']
LAST = ['Martinez', 'Clark', 'Lewis', 'Walker', 'Hall', 'Allen', 'Young', 'King', 'Wright', 'Lopez', 'Hill',
        'Scott', 'Green', 'Adams', 'Baker', 'Nelson', 'Carter', 'Mitchell', 'Perez', 'Roberts', 'Turner',
        'Phillips', 'Campbell', 'Parker', 'Evans', 'Edwards', 'Collins', 'Stewart', 'Sanchez', 'Morris',
        'Rogers', 'Reed', 'Cook', 'Morgan', 'Bell', 'Murphy', 'Bailey', 'Rivera', 'Cooper', 'Kim', 'Shah']
STREETS = ['Oak', 'Maple', 'Cedar', 'Pine', 'Elm', 'Willow', 'Lake', 'Hill', 'River', 'Park', 'Sunset', 'Ridge']
CARDS = ['Chase Sapphire', 'Chase Freedom', 'Citi Double Cash', 'Citi Custom Cash', 'Amex Gold', 'Amex Blue Cash',
         'Discover It', 'Capital One Venture', 'Capital One Quicksilver', 'Wells Fargo Active Cash',
         'Bank of America Cash Rewards', 'Barclays View', 'Synchrony Store Card', 'Apple Card', 'US Bank Altitude']
PERSONAL = ['SoFi Personal', 'LendingClub Personal', 'Upstart Personal', 'Marcus Personal', 'Best Egg Personal',
            'Prosper Personal', 'Avant Personal', 'OneMain Personal', 'Discover Personal']
AUTO = ['Toyota Financial', 'Honda Financial', 'Ford Credit', 'GM Financial', 'Ally Auto', 'Nissan Motor Acceptance',
        'Hyundai Capital', 'Capital One Auto']
STUDENT = ['Navient Student Loan', 'Nelnet Student Loan', 'Sallie Mae Student Loan', 'MOHELA Student Loan']
MORTGAGE = ['Rocket Mortgage', 'Wells Fargo Mortgage', 'Chase Mortgage', 'US Bank Mortgage', 'Guaranteed Rate Mortgage',
            'Mr. Cooper Mortgage', 'Truist Mortgage', 'PNC Mortgage', 'Flagstar Mortgage', 'Huntington Mortgage']


def wpick(pairs):
    tot = sum(w for _, w in pairs)
    x = rng.uniform(0, tot)
    for v, w in pairs:
        x -= w
        if x <= 0:
            return v
    return pairs[-1][0]


def fico():
    return max(560, min(840, int(rng.gauss(712, 55))))


ids = [i for i in range(17, 301) if i != 22]
advisor_names = list(ADVISORS)
new_h, new_m, new_d, new_p = [], [], [], []
debt_seq = {}


def add_debt(hid, name, dtype, bal, rate, pay, pid=''):
    debt_seq[hid] = debt_seq.get(hid, 0) + 1
    did = f"{hid}-D{debt_seq[hid]:02d}"
    new_d.append(dict(debt_id=did, household_id=hid, debt_name=name, debt_type=dtype, balance=r2(bal, 50),
                      rate=round(rate, 2), monthly_payment=r2(pay), property_id=pid, last_updated='2026-11-13',
                      origin='generated'))
    return new_d[-1]


for n in ids:
    hid = f"H{n}"
    adv = advisor_names[(n * 7) % len(advisor_names)]
    st = wpick(STATES)
    couple = rng.random() < 0.6
    last = rng.choice(LAST)
    f1 = rng.choice(FIRST)
    f2 = rng.choice([f for f in FIRST if f != f1])
    name = f"{last}, {f1} and {f2}" if couple else f"{last}, {f1}"
    income = r2(max(38000, rng.lognormvariate(math.log(115000), 0.42)), 1000)
    cz = wpick([('1', 25), ('2', 50), ('3', 25)])
    new_h.append(dict(household_id=hid, household_name=name, advisor=adv, home_state=st, comfort_zone=cz,
                      annual_income=income, branch=ADVISORS[adv]))
    for k, fn in enumerate([f1, f2] if couple else [f1]):
        score = '' if rng.random() < 0.15 else fico()
        new_m.append(dict(member_id=f"{hid}-M{k + 1}", household_id=hid, member_name=f"{fn} {last}",
                          role='Primary' if k == 0 else 'Spouse', fico=score))

    archetype = wpick([('owner', 62), ('renter', 32), ('retiree_reverse', 3), ('owner_investor', 8)])
    if archetype in ('owner', 'owner_investor', 'retiree_reverse'):
        val = r2(max(140000, rng.lognormvariate(math.log(420000), 0.38)), 5000)
        pid = f"P{n}A"
        asof = date(2026, rng.randint(1, 10), rng.randint(1, 28)).isoformat()
        new_p.append(dict(property_id=pid, household_id=hid,
                          address=f"{rng.randint(10, 9999)} {rng.choice(STREETS)} St, {CITIES[st]}, {st}",
                          value=val, property_type='Residence', value_as_of=asof))
        if archetype == 'retiree_reverse':
            add_debt(hid, 'AAG Reverse Mortgage', 'Reverse mortgage', val * rng.uniform(0.25, 0.5),
                     rng.uniform(6.2, 7.4), 0, pid)
        else:
            ltv = rng.uniform(0.3, 0.8)
            rate = wpick([(rng.uniform(2.75, 3.75), 30), (rng.uniform(4.0, 5.5), 30), (rng.uniform(5.75, 7.5), 40)])
            bal = val * ltv
            add_debt(hid, rng.choice(MORTGAGE), 'Mortgage', bal, rate, amort(bal, rate, rng.randint(180, 340)), pid)
            if rng.random() < 0.12:
                heb = val * rng.uniform(0.05, 0.12)
                add_debt(hid, 'Figure Home Equity', 'Home equity loan', heb, rng.uniform(8.5, 10.5),
                         amort(heb, 9.5, rng.randint(96, 180)), pid)
        if archetype == 'owner_investor':
            v2 = r2(rng.uniform(180000, 450000), 5000)
            pid2 = f"P{n}B"
            new_p.append(dict(property_id=pid2, household_id=hid,
                              address=f"{rng.randint(10, 9999)} {rng.choice(STREETS)} Ave, {CITIES[st]}, {st}",
                              value=v2, property_type='Investment',
                              value_as_of=date(2026, rng.randint(1, 10), rng.randint(1, 28)).isoformat()))
            b2 = v2 * rng.uniform(0.4, 0.7)
            add_debt(hid, 'PNC Mortgage (rental)', 'Mortgage', b2, rng.uniform(6.5, 7.6),
                     amort(b2, 7.0, rng.randint(240, 340)), pid2)
    # unsecured debts
    for _ in range(wpick([(0, 8), (1, 22), (2, 32), (3, 25), (4, 13)])):
        b = rng.uniform(1500, 24000)
        share = 0.03 if rng.random() < 0.7 else rng.uniform(0.035, 0.08)
        add_debt(hid, rng.choice(CARDS), 'Credit card', b, rng.uniform(18.5, 30.5), b * share)
    for _ in range(wpick([(0, 55), (1, 38), (2, 7)])):
        b = rng.uniform(3000, 30000)
        r = rng.uniform(9, 25)
        add_debt(hid, rng.choice(PERSONAL), 'Personal', b, r, amort(b, r, rng.randint(24, 60)))
    for _ in range(wpick([(0, 45), (1, 45), (2, 10)])):
        b = rng.uniform(8000, 42000)
        r = wpick([(rng.uniform(3.9, 7.5), 70), (rng.uniform(8, 13), 30)])
        add_debt(hid, rng.choice(AUTO), 'Auto', b, r, amort(b, r, rng.randint(30, 72)))
    for _ in range(wpick([(0, 70), (1, 22), (2, 8)])):
        b = rng.uniform(8000, 65000)
        r = rng.uniform(3.5, 7.8)
        add_debt(hid, rng.choice(STUDENT), 'Student loan', b, r, amort(b, r, 120))
    if rng.random() < 0.06:
        b = rng.uniform(5000, 25000)
        add_debt(hid, 'Chase Business Line', 'Line of credit', b, rng.uniform(9, 14), b * 0.025)
    if rng.random() < 0.04:
        b = rng.uniform(8000, 30000)
        add_debt(hid, 'Chase Ink Business', 'Business', b, rng.uniform(17, 24), b * 0.03)
    if rng.random() < 0.05:
        b = rng.uniform(8000, 28000)
        add_debt(hid, 'Payoff Debt Consolidation', 'Debt consolidation', b, rng.uniform(11, 18),
                 amort(b, 14, rng.randint(36, 60)))
    if rng.random() < 0.05:
        b = rng.uniform(800, 6000)
        add_debt(hid, 'Medical Payment Plan', 'Other', b, rng.uniform(0, 9), b / rng.randint(12, 36))
    if not [d for d in new_d if d['household_id'] == hid]:
        b = rng.uniform(2000, 9000)
        add_debt(hid, rng.choice(CARDS), 'Credit card', b, rng.uniform(19, 29), b * 0.03)

# keep generated income plausible: debt payments at most ~50% of gross income
for h in new_h:
    pay = sum(d['monthly_payment'] for d in new_d if d['household_id'] == h['household_id'])
    if pay * 12 > 0.5 * h['annual_income']:
        h['annual_income'] = r2(pay * 12 / rng.uniform(0.25, 0.5), 1000)

# ---------- inject data issues into ~10% of generated households ----------
expected = []  # ground truth for QA
pool = [h['household_id'] for h in new_h]
rng.shuffle(pool)
H = {h['household_id']: h for h in new_h}


def take(pred, k):
    out = []
    for hid in pool:
        if len(out) == k:
            break
        if hid not in used and pred(hid):
            out.append(hid)
            used.add(hid)
    return out


used = set()
hdebts = lambda hid: [d for d in new_d if d['household_id'] == hid]
hprops = lambda hid: [p for p in new_p if p['household_id'] == hid]

for hid in take(lambda h: True, 5):
    for m in new_m:
        if m['household_id'] == hid:
            m['fico'] = ''
    expected.append((hid, '', 'no_fico_any_member', 'Use 740 default; flag'))
for hid in take(lambda h: True, 3):
    H[hid]['comfort_zone'] = ''
    expected.append((hid, '', 'missing_comfort_zone', 'Not FastApp-eligible; flag'))
for hid in take(lambda h: any(d['debt_type'] in ('Student loan', 'Other') for d in hdebts(h)), 4):
    d = next(d for d in hdebts(hid) if d['debt_type'] in ('Student loan', 'Other'))
    d['monthly_payment'] = 0
    expected.append((hid, d['debt_id'], 'zero_payment', 'Exclude from all calculations; flag'))
for hid in take(lambda h: any(d['debt_type'] == 'Credit card' and d['balance'] > 6000 for d in hdebts(h)), 4):
    d = next(d for d in hdebts(hid) if d['debt_type'] == 'Credit card' and d['balance'] > 6000)
    d['monthly_payment'] = r2(d['balance'] * d['rate'] / 1200 * rng.uniform(0.6, 0.9))
    expected.append((hid, d['debt_id'], 'payment_below_interest', 'Include; flag never pays off; advisor may edit'))
for hid in take(lambda h: any(d['debt_type'] == 'Credit card' for d in hdebts(h)), 3):
    d = next(d for d in hdebts(hid) if d['debt_type'] == 'Credit card')
    d['rate'] = 0.0
    expected.append((hid, d['debt_id'], 'zero_rate', 'Include; flag; advisor may edit rate'))
for hid in take(lambda h: any(d['debt_type'] == 'Credit card' for d in hdebts(h)), 3):
    d = next(d for d in hdebts(hid) if d['debt_type'] == 'Credit card')
    debt_seq[hid] += 1
    dup = dict(d, debt_id=f"{hid}-D{debt_seq[hid]:02d}")
    new_d.append(dup)
    expected.append((hid, f"{d['debt_id']};{dup['debt_id']}", 'possible_duplicate', 'Keep both; flag'))
for hid in take(lambda h: True, 3):
    H[hid]['annual_income'] = r2(H[hid]['annual_income'] / 12, 100)
    expected.append((hid, '', 'income_implausible', 'Income not used in any rule; flag'))
for hid in take(lambda h: True, 3):
    H[hid]['annual_income'] = ''
    expected.append((hid, '', 'income_missing', 'Income not used in any rule'))
for hid in take(lambda h: any(p['property_type'] == 'Residence' for p in hprops(h))
                and any(d['debt_type'] == 'Mortgage' for d in hdebts(h)), 3):
    p = next(p for p in hprops(hid) if p['property_type'] == 'Residence')
    p['value'] = r2(p['value'] * rng.uniform(0.25, 0.4), 1000)
    p['value_as_of'] = date(rng.randint(1994, 2004), rng.randint(1, 12), 15).isoformat()
    expected.append((hid, p['property_id'], 'stale_property_value', 'Use as is; flag; advisor may edit'))
for hid in take(lambda h: any(d['debt_type'] == 'Mortgage' for d in hdebts(h)), 3):
    d = next(d for d in hdebts(hid) if d['debt_type'] == 'Mortgage')
    expected.append((hid, d['debt_id'], 'mortgage_unlinked', 'No home equity offer until linked; flag'))
    d['property_id'] = ''

# sample households' known issues (for QA completeness)
for row in [('H03', '', 'no_fico_any_member'), ('H04', '', 'no_fico_any_member'), ('H11', '', 'no_fico_any_member'),
            ('H16', '', 'missing_comfort_zone'), ('H07', 'H07-D01', 'zero_payment'),
            ('H10', 'H10-D02', 'zero_payment'), ('H07', 'H07-D02', 'payment_below_interest'),
            ('H08', 'H08-D02', 'zero_rate'), ('H11', 'H11-D01;H11-D02', 'possible_duplicate'),
            ('H08', '', 'income_implausible'), ('H10', '', 'income_missing'),
            ('H09', 'P09', 'stale_property_value'), ('H15', 'H15-D01', 'mortgage_unlinked'),
            ('H22', '', 'fastapp_orphan')]:
    expected.append(row + ('see rules',))

# issues that occur naturally (not injected): no score for any member, reverse mortgages ($0 payment)
for h in new_h:
    hid = h['household_id']
    if all(not m['fico'] for m in new_m if m['household_id'] == hid) and \
            not any(e[0] == hid and e[2] == 'no_fico_any_member' for e in expected):
        expected.append((hid, '', 'no_fico_any_member', 'Use 740 default; flag (natural)'))
for d in new_d:
    if d['debt_type'] == 'Reverse mortgage':
        expected.append((d['household_id'], d['debt_id'], 'zero_payment', 'Reverse mortgage: exclude (natural)'))

# ---------- FastApp list ----------
fa = list(fastapp)
for h in new_h:
    if rng.random() < 0.33:
        fa.append(dict(household_id=h['household_id'], approved_on=rng.choice(['2026-10-28', '2026-11-04'])))
for orphan in ['H950', 'H951']:
    fa.append(dict(household_id=orphan, approved_on='2026-11-04'))
    expected.append((orphan, '', 'fastapp_orphan', 'Ignore; log'))


def write(name, rows, cols):
    with open(os.path.join(OUT, name), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction='ignore')
        w.writeheader()
        w.writerows(rows)


all_h = households + new_h
write('households.csv', all_h, ['household_id', 'household_name', 'advisor', 'branch', 'home_state', 'comfort_zone',
                                'annual_income'])
write('household_members.csv', members + new_m, ['member_id', 'household_id', 'member_name', 'role', 'fico'])
write('debts.csv', debts + new_d, ['debt_id', 'household_id', 'debt_name', 'debt_type', 'balance', 'rate',
                                   'monthly_payment', 'property_id', 'last_updated'])
write('properties.csv', properties + new_p, ['property_id', 'household_id', 'address', 'value', 'property_type',
                                             'value_as_of'])
write('fastapp_list.csv', fa, ['household_id', 'approved_on'])
write('loan_products.csv', products, ['product', 'term_months', 'comfort_zone', 'rate', 'rates_as_of'])
write('qa_expected_data_issues.csv',
      [dict(household_id=a, entity_id=b, issue_type=c, rule=d) for a, b, c, d in expected],
      ['household_id', 'entity_id', 'issue_type', 'rule'])
print('households', len(all_h), 'members', len(members + new_m), 'debts', len(debts + new_d),
      'properties', len(properties + new_p), 'fastapp', len(fa), 'injected households', len(used))
