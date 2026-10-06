"""Drive the built site in Chromium: the calculator must match hashlib, the
file tab must hash a file, and no page may overflow a phone screen or log errors."""
import hashlib, http.server, os, socketserver, threading, tempfile
from functools import partial
from playwright.sync_api import sync_playwright

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'docs')
PORT = 8791
handler = partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
handler.log_message = lambda *a: None
srv = socketserver.TCPServer(('127.0.0.1', PORT), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{PORT}'
fails = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        fails.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

    pg.goto(base + '/')
    v = pg.text_content('#v_sha3_256').strip()
    check(v == hashlib.sha3_256(b'hello world').hexdigest(), 'default SHA3-256(hello world)')
    pg.fill('#in', 'abc')
    for algo, ref in [('sha3_224', hashlib.sha3_224), ('sha3_384', hashlib.sha3_384), ('sha3_512', hashlib.sha3_512)]:
        check(pg.text_content('#v_' + algo).strip() == ref(b'abc').hexdigest(), algo + '(abc)')
    check(pg.text_content('#v_shake128').strip() == hashlib.shake_128(b'abc').hexdigest(32), 'SHAKE128(abc) 256 bits')
    check(pg.text_content('#v_keccak256').strip() == '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45', 'Keccak-256(abc)')
    pg.fill('#xoflen', '512')
    check(pg.text_content('#v_shake256').strip() == hashlib.shake_256(b'abc').hexdigest(64), 'SHAKE256 512-bit length')
    pg.fill('#in', 'héllo ✓')
    check(pg.text_content('#v_sha3_256').strip() == hashlib.sha3_256('héllo ✓'.encode()).hexdigest(), 'UTF-8 input')
    pg.select_option('#mode', 'hex')
    pg.fill('#in', '616263')
    check(pg.text_content('#v_sha3_256').strip() == hashlib.sha3_256(b'abc').hexdigest(), 'hex input')
    pg.fill('#in', '61626')
    check('even' in pg.text_content('#err'), 'odd hex shows an error')
    pg.select_option('#mode', 'text')

    # file tab
    fd, fp = tempfile.mkstemp(suffix='.bin'); os.close(fd)
    data = os.urandom(300000)
    open(fp, 'wb').write(data)
    pg.click('[data-tab=file]')
    pg.set_input_files('#file', fp)
    pg.wait_for_function("document.getElementById('fileinfo').textContent.includes('hashed locally')")
    check(pg.text_content('#v_sha3_256').strip() == hashlib.sha3_256(data).hexdigest(), 'file SHA3-256 (300 KB)')
    os.remove(fp)

    # ?q= deep link
    pg.goto(base + '/?q=hello%20world')
    check(pg.text_content('#v_sha3_256').strip() == hashlib.sha3_256(b'hello world').hexdigest(), '?q= link')

    # every page: loads, no horizontal overflow on a phone, has the sale link
    m = b.new_page(viewport={'width': 375, 'height': 812})
    m.on('pageerror', lambda e: errors.append(str(e)))
    # /404.html directly: python's test server does not serve it for missing
    # paths, but GitHub Pages does.
    for path in ['/', '/what-is-sha3/', '/sha3-vs-sha256/', '/sha3-vs-keccak/', '/test-vectors/', '/code-examples/', '/buy/', '/404.html']:
        r = m.goto(base + path)
        sw = m.evaluate('document.documentElement.scrollWidth')
        check(sw <= 375, f'{path} fits 375px (scrollWidth {sw})')
        check(m.locator('a[href="/buy/"]').count() > 0, f'{path} has a sale link')
    m.screenshot(path=os.path.join(tempfile.gettempdir(), 'sha3-mobile.png'), full_page=False)
    pg.goto(base + '/')
    pg.screenshot(path=os.path.join(tempfile.gettempdir(), 'sha3-desktop.png'), full_page=True)
    check(not errors, 'no console or page errors: ' + '; '.join(errors[:3]))
    b.close()

srv.shutdown()
print('\nFAILED: %d' % len(fails) if fails else '\nALL PASS')
