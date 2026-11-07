"""Turn ESMA's interim MiCA register of crypto-asset service providers (CASPS.csv)
into the compact register.json used by the scanner (app/data) and by the site's
firm search (docs/assets).  Usage: python tools/make_register.py [CASPS.csv]

Source: https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica
(the CSV linked from that page). Public data, republished as-is in compact form."""
import csv, json, os, re, sys
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', 'data', 'esma-casps-2026-10-30.csv')
AS_OF = re.search(r'(\d{4}-\d{2}-\d{2})', os.path.basename(SRC))
AS_OF = AS_OF.group(1) if AS_OF else ''

# MiCA Art. 3(1)(16): the ten crypto-asset services, by letter.
SERVICES = {
    'a': 'custody and administration of crypto-assets on behalf of clients',
    'b': 'operation of a trading platform for crypto-assets',
    'c': 'exchange of crypto-assets for funds',
    'd': 'exchange of crypto-assets for other crypto-assets',
    'e': 'execution of orders for crypto-assets on behalf of clients',
    'f': 'placing of crypto-assets',
    'g': 'reception and transmission of orders for crypto-assets on behalf of clients',
    'h': 'providing advice on crypto-assets',
    'i': 'providing portfolio management on crypto-assets',
    'j': 'providing transfer services for crypto-assets on behalf of clients',
}
KEYWORDS = [('custody', 'a'), ('trading platform', 'b'), ('for funds', 'c'), ('for other crypto', 'd'),
            ('execution of orders', 'e'), ('placing', 'f'), ('reception and transmission', 'g'),
            ('advice', 'h'), ('portfolio management', 'i'), ('transfer services', 'j')]


def services(raw):
    out = set()
    for part in raw.split('|'):
        part = part.strip().lower()
        m = re.match(r'^([a-j])[.)]\s', part)
        if m:
            out.add(m.group(1))
            continue
        for kw, letter in KEYWORDS:
            if kw in part:
                out.add(letter)
    return ''.join(sorted(out))


def sites(raw):
    found = []
    for m in re.finditer(r'(https?://[^\s|,;]+|(?<![@\w])(?:[\w-]+\.)+[a-z]{2,}(?:/[^\s|,;]*)?)', raw, re.I):
        u = m.group(1).rstrip('.')
        if not u.lower().startswith('http'):
            u = 'https://' + u
        host = (urlparse(u).hostname or '').lower()
        if host and host not in [urlparse(f).hostname for f in found]:
            found.append(u)
    return found


def authority(raw):
    m = re.search(r'\(([^)]+)\)\s*$', raw.strip())
    return m.group(1) if m else raw.strip()


rows = list(csv.DictReader(open(SRC, encoding='utf-8-sig')))
firms = {}
for r in rows:
    lei = r['ae_lei'].strip()
    key = lei or r['ae_lei_name'].strip()
    f = firms.setdefault(key, {
        'n': r['ae_lei_name'].strip(),
        'c': r['ae_commercial_name'].strip(),
        'lei': lei,
        's': r['ae_homeMemberState'].strip(),
        'a': authority(r['ae_competentAuthority']),
        'w': sites(r['ae_website']),
        'sv': '',
        'd': r['ac_authorisationNotificationDate'].strip(),
    })
    f['sv'] = ''.join(sorted(set(f['sv']) | set(services(r['ac_serviceCode']))))
    for u in sites(r['ae_website']):
        if u not in f['w']:
            f['w'].append(u)

out = {'source': 'ESMA interim MiCA register (CASPS.csv)', 'as_of': AS_OF, 'services': SERVICES,
       'firms': sorted(firms.values(), key=lambda f: (f['c'] or f['n']).lower())}
text = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
for target in (os.path.join(ROOT, 'app', 'data', 'register.json'), os.path.join(ROOT, 'docs', 'assets', 'register.json')):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)
print(len(out['firms']), 'firms,', sum(1 for f in out['firms'] if not f['w']), 'without a website,', len(text), 'bytes')
