"""Browser test of the MiCA flow against the local dev server (tests/dev-server.mjs).
Usage: python -I tests/e2e.py [base_url] [shot_dir]"""
import os, sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8792'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.environ.get('LOCALAPPDATA', '.'), 'Temp', 'sha3si', 'shots')
os.makedirs(SHOTS, exist_ok=True)
fails = []


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        fails.append(msg)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 900})
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

    pg.goto(BASE + '/')
    check('supervisor' in pg.inner_text('h1'), 'home hero renders')
    pg.fill('#scan-url', 'coinh')
    pg.wait_for_selector('#scan-suggest li', timeout=5000)
    check('coinhouse' in pg.inner_text('#scan-suggest').lower(), 'firm search suggests Coinhouse from the register')
    pg.keyboard.press('ArrowDown')
    pg.keyboard.press('Enter')
    check(pg.input_value('#scan-url') == 'coinhouse.com', 'picking a firm fills its website')
    pg.click('#scan-form button[type=submit]')
    pg.wait_for_selector('.rep-head', timeout=150000)
    log = pg.inner_text('.scan-log')
    check('Homepage read' in log and 'sha3' in log, 'live log streams fetches with fingerprints')
    check(pg.locator('.rep-check').count() == 8, 'report shows the 8 checks')
    check('COINHOUSE' in pg.inner_text('.rep-head').upper(), 'report names the registered firm')
    link = pg.input_value('.rep-link input')
    check('/r/?id=' in link and '&t=' in link, 'private link offered')
    pg.screenshot(path=os.path.join(SHOTS, 'home-report.png'), full_page=True)

    pg.click('.offer .btn.primary')
    pg.wait_for_selector('#buy-dialog[open]')
    pg.fill('#buy-form input[name=email]', 'test.compliance@example.com')
    pg.click('#buy-form button[type=submit]')
    pg.wait_for_selector('#lead-dialog[open]', timeout=10000)
    check('payment opens shortly' in pg.inner_text('#lead-note').lower(), 'payments off: order falls back to the request form')
    pg.fill('#lead-form input[name=name]', 'Test Person')
    pg.check('#lead-form input[name=consent]')
    pg.fill('#lead-form input[name=email]', 'test.compliance@example.com')
    pg.click('#lead-form button[type=submit]')
    pg.wait_for_selector('#lead-ok:not([hidden])', timeout=10000)
    check(True, 'lead form submits and thanks the visitor')

    pg.goto(link.replace('https://sha3.si', BASE))
    pg.wait_for_selector('.rep-head', timeout=20000)
    check(pg.locator('.rep-check').count() == 8, 'private report link reopens the same report')
    rh = pg.locator('.rep-evidence .mono').last.text_content().split(': ')[-1].strip()
    pg.goto(BASE + '/evidence/?h=' + rh)
    pg.wait_for_selector('#evidence h2', timeout=20000)
    check('anchored after their day ends' in pg.inner_text('#evidence'), 'evidence page finds the record (anchor pending today)')

    pg.goto(BASE + '/mica-checklist/')
    check(pg.locator('article h2').count() >= 9, 'checklist page lists every duty')

    m = b.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
    mp = m.new_page()
    mp.on('pageerror', lambda e: errors.append(str(e)))
    for path in ['/', '/mica-checklist/', '/evidence/', '/privacy/', '/terms/', '/calculator/', '/r/?id=x&t=y']:
        mp.goto(BASE + path)
        mp.wait_for_timeout(400)
        over = mp.evaluate('document.documentElement.scrollWidth - window.innerWidth')
        check(over <= 0, f'no horizontal overflow on a phone: {path} ({over}px)')
    mp.goto(BASE + '/')
    mp.screenshot(path=os.path.join(SHOTS, 'home-mobile.png'), full_page=True)
    check(not errors, 'no console or page errors' + ('' if not errors else ': ' + ' | '.join(errors[:5])))
    b.close()

print('\n%d failure(s)' % len(fails))
sys.exit(1 if fails else 0)
