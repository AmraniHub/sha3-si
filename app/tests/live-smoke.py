"""Smoke test of the published site: scan from https://sha3.si in a real browser.
Usage: python -I tests/live-smoke.py [site]"""
import sys
from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else 'https://sha3.si'
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.goto(SITE + '/?smoke=1')
    pg.fill('#scan-url', 'weareblox.com')
    pg.click('#scan-form button[type=submit]')
    pg.wait_for_selector('.rep-head', timeout=180000)
    print('report:', pg.inner_text('.rep-head').replace('\n', ' | ')[:220])
    print('checks:', pg.locator('.rep-check').count())
    print('read from:', 'Frankfurt' in pg.inner_text('.rep-head'))
    print('errors:', errors or 'none')
    b.close()
