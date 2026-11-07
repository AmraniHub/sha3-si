"""Generate the static sha3.si site into ./site.

Every digest shown on the site is computed here at build time (Python hashlib
for SHA-3/SHAKE/SHA-2, the vendored js-sha3 under Node for Keccak-256), so no
number on a page is typed by hand.  Run:  python build.py
"""
import hashlib, html, json, os, subprocess
from datetime import date

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, 'docs')
DOMAIN = 'https://sha3.si'
GA_ID = 'G-MLWFJRRJ1T'  # GA4 property for sha3.si
# The scan / payments API (app/ in this repo, Vercel fra1). Until api.sha3.si
# has a DNS record, the site calls the project's Vercel alias directly.
API_URL = os.environ.get('SHA3SI_API', 'https://sha3si-app-amranihubs-projects.vercel.app')
COMPANY = 'Servolia LLC'
COMPANY_ADDRESS = '30 N Gould St, Ste R, Sheridan, WY 82801, USA'
CONTACT = 'hello@sha3.si'
with open(os.path.join(ROOT, 'app', 'data', 'checklist.json'), encoding='utf-8') as _f:
    CHECKLIST = json.load(_f)
with open(os.path.join(ROOT, 'app', 'data', 'register.json'), encoding='utf-8') as _f:
    _REG = json.load(_f)
REGISTER_COUNT = len(_REG['firms'])
REGISTER_AS_OF = _REG['as_of']
TODAY = date.today().isoformat()


# ---------------------------------------------------------------- vectors
def keccak256(msgs):
    js = ("const s=require(process.argv[1]);"
          "const m=JSON.parse(process.argv[2]);"
          "console.log(JSON.stringify(m.map(x=>s.keccak256(x))));")
    r = subprocess.run(['node', '-e', js, os.path.join(SITE, 'assets', 'sha3.min.js'), json.dumps(msgs)],
                       capture_output=True, check=True)
    return json.loads(r.stdout.decode())

MSGS = ['', 'abc', 'hello world', 'The quick brown fox jumps over the lazy dog']
KEC = dict(zip(MSGS, keccak256(MSGS)))

def vec(m):
    b = m.encode()
    return {
        'sha3_224': hashlib.sha3_224(b).hexdigest(),
        'sha3_256': hashlib.sha3_256(b).hexdigest(),
        'sha3_384': hashlib.sha3_384(b).hexdigest(),
        'sha3_512': hashlib.sha3_512(b).hexdigest(),
        'shake128_256': hashlib.shake_128(b).hexdigest(32),
        'shake256_512': hashlib.shake_256(b).hexdigest(64),
        'sha256': hashlib.sha256(b).hexdigest(),
        'keccak256': KEC[m],
    }

V = {m: vec(m) for m in MSGS}
HW = V['hello world']


# ---------------------------------------------------------------- layout
NAV = [
    ('/', 'MiCA scan'),
    ('/mica-checklist/', 'What we check'),
    ('/evidence/', 'Verify evidence'),
    ('/#pricing', 'Pricing'),
    ('/calculator/', 'SHA-3 tools'),
]
# The MiCA service pages carry no analytics: no cookies, no tracking (see /privacy/).
MICA_PAGES = {'/', '/mica-checklist/', '/r/', '/account/', '/evidence/', '/privacy/', '/terms/'}
GUIDES = [('/sha3-vs-sha256/', 'SHA-3 vs SHA-256'), ('/test-vectors/', 'Test vectors'),
          ('/what-is-sha3/', 'What is SHA-3'), ('/sha3-vs-keccak/', 'SHA-3 vs Keccak')]
# The checker service (checker/ in this repo), deployed on Railway.
CHECKER_URL = 'https://checker-production-c609.up.railway.app'

def ga():
    if not GA_ID:
        return ''
    return (f'<script async src="https://www.googletagmanager.com/gtag/js?id={GA_ID}"></script>'
            f"<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}"
            f"gtag('js',new Date());gtag('config','{GA_ID}');</script>")

LOGO_SVG = ('<svg class="mark" viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">'
            '<rect width="64" height="64" rx="14" fill="#0b0f14"/>'
            '<path d="M14 18h36M14 32h36M14 46h36" stroke="#1f2a37" stroke-width="4"/>'
            '<path d="M20 14v36M32 14v36M44 14v36" stroke="#39d3a0" stroke-width="5" stroke-linecap="round"/>'
            '</svg>')

ALGO_LINKS = [('/sha3-256/', 'SHA3-256'), ('/sha3-512/', 'SHA3-512'), ('/keccak-256/', 'Keccak-256'), ('/shake256/', 'SHAKE256')]

def breadcrumb(path, name):
    if path == '/':
        return None
    return {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': 1, 'name': 'sha3.si', 'item': DOMAIN + '/'},
        {'@type': 'ListItem', 'position': 2, 'name': name, 'item': DOMAIN + path}]}

def page(path, title, desc, body, schema=None, scripts='', focus='', noindex=False):
    nav = ''.join(f'<a href="{h}"{" class=on" if h == path else ""}>{t}</a>' for h, t in NAV)
    robots = '<meta name="robots" content="noindex, nofollow">\n' if noindex else ''
    ld = ''
    crumb = breadcrumb(path, title.split(' | ')[0].split(':')[0])
    for s in (schema or []) + ([crumb] if crumb else []):
        ld += '<script type="application/ld+json">' + json.dumps(s, ensure_ascii=False) + '</script>'
    tools = ' &middot; '.join(f'<a href="{h}">{t}</a>' for h, t in ALGO_LINKS)
    body_attr = f' data-focus="{focus}"' if focus else ''
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
{robots}<link rel="canonical" href="{DOMAIN}{path}">
<meta name="sha3si-api" content="{API_URL}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="sha3.si">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:url" content="{DOMAIN}{path}">
<meta property="og:image" content="{DOMAIN}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="sha3.si: MiCA website evidence for EU crypto firms, read from Frankfurt and anchored in Bitcoin.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{DOMAIN}/og.png">
<meta name="theme-color" content="#0b0f14">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="/assets/style.css">
<link rel="stylesheet" href="/assets/mica.css">
{'' if path in MICA_PAGES else ga()}{ld}
</head>
<body{body_attr}>
<header class="top"><div class="wrap">
<a class="logo" href="/">{LOGO_SVG}<b>sha3<span>.si</span></b></a>
<nav class="main">{nav}</nav>
</div></header>
<main class="wrap">
{body}
</main>
<footer><div class="wrap">
<span><b>sha3.si</b>: MiCA website evidence for crypto-asset service providers. Observations of what a website shows, not legal advice. A service of {COMPANY}, {COMPANY_ADDRESS}. <a href="mailto:{CONTACT}">{CONTACT}</a></span>
<span>MiCA: <a href="/">Free scan</a> &middot; <a href="/mica-checklist/">Website checklist</a> &middot; <a href="/evidence/">Verify evidence</a> &middot; <a href="/#pricing">Pricing</a> &middot; <a href="/privacy/">Privacy</a> &middot; <a href="/terms/">Terms</a></span>
<span>SHA-3 tools: <a href="/calculator/">Calculator</a> &middot; {tools} &middot; <a href="/quantum-safe/">Quantum-safe check</a></span>
<span>Guides: {' &middot; '.join(f'<a href="{h}">{t}</a>' for h, t in GUIDES)} &middot; <a href="/llms.txt">llms.txt</a> &middot; <a href="/sitemap.xml">sitemap</a></span>
</div></footer>
{scripts}
</body>
</html>
"""

def buybox():
    """The call to action on reference pages: the MiCA scan (formerly the domain sale box)."""
    return """<div class="buy">
<h2>Run a crypto firm in the EU?</h2>
<p>sha3.si reads your website from Frankfurt, two clicks deep, checks every MiCA disclosure and fingerprints each page with SHA3-256, anchored in Bitcoin. Free, in about a minute.</p>
<a class="btn primary" href="/#scan">Scan your website free</a>
<a class="btn" href="/mica-checklist/">What MiCA asks of your site</a>
</div>"""

def code(s):
    return '<pre><code>' + html.escape(s.strip('\n')) + '</code></pre>'

def org():
    return {'@type': 'Organization', 'name': 'sha3.si', 'url': DOMAIN, 'logo': DOMAIN + '/icon-512.png',
            'email': CONTACT, 'parentOrganization': {'@type': 'Organization', 'name': COMPANY}}

def article_schema(path, headline, desc):
    return {'@context': 'https://schema.org', '@type': 'TechArticle', 'headline': headline,
            'description': desc, 'url': DOMAIN + path, 'dateModified': TODAY,
            'author': org(), 'publisher': org(),
            'about': {'@type': 'Thing', 'name': 'SHA-3', 'sameAs': 'https://en.wikipedia.org/wiki/SHA-3'}}

def faq_schema(qa):
    return {'@context': 'https://schema.org', '@type': 'FAQPage',
            'mainEntity': [{'@type': 'Question', 'name': q,
                            'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in qa]}


# ---------------------------------------------------------------- pages
PAGES = {}

# The SHA-3 calculator (the site's homepage until the MiCA service took /)
home_desc = ('Free online SHA-3 hash calculator: SHA3-224, SHA3-256, SHA3-384, SHA3-512, SHAKE128, SHAKE256 '
             'and Ethereum Keccak-256. Hash text, hex or files, all locally in your browser.')
home_faq = [
    ('Is my input sent to a server?',
     'No. Every hash on sha3.si is computed in your browser with JavaScript. Text and files never leave your device.'),
    ('What is the SHA3-256 hash of an empty string?',
     f"SHA3-256('') = {V['']['sha3_256']}"),
    ('Why does my Ethereum keccak256 not match SHA3-256?',
     'Ethereum uses the original Keccak padding, which differs from the final NIST SHA-3 standard (FIPS 202). '
     'Same permutation, different padding byte, completely different output. Use the Keccak-256 row for Ethereum.'),
    ('What is SHAKE?',
     'SHAKE128 and SHAKE256 are the extendable-output functions (XOFs) of the SHA-3 family: you choose the output length.'),
]
PAGES['/calculator/'] = page('/calculator/', 'SHA-3 Hash Calculator Online: SHA3-256, SHA3-512, SHAKE, Keccak | sha3.si', home_desc, f"""
<section class="hero">
<h1>SHA-3 hash calculator</h1>
<p class="lead">SHA3-224, SHA3-256, SHA3-384, SHA3-512, SHAKE128, SHAKE256 and Ethereum Keccak-256, all at once. Text, hex or files, hashed locally in your browser.</p>
</section>

<section class="panel" aria-label="SHA-3 calculator">
<div class="tabs">
<button type="button" data-tab="text" class="on">Text</button>
<button type="button" data-tab="file">File</button>
</div>
<div id="pane-text">
<label for="in" class="hidden">Input</label>
<textarea id="in" spellcheck="false" placeholder="Type or paste text to hash...">hello world</textarea>
</div>
<div id="pane-file" class="hidden">
<div id="drop" class="drop">Drop a file here, or click to choose one.<br><small>The file is read in your browser and never uploaded.</small></div>
<input id="file" type="file" class="hidden">
<div class="note" id="fileinfo"></div>
</div>
<div class="opts">
<label>Input <select id="mode"><option value="text">UTF-8 text</option><option value="hex">Hex bytes</option></select></label>
<label>Output <select id="fmt"><option value="hex">hex</option><option value="HEX">HEX</option><option value="b64">Base64</option></select></label>
<label>SHAKE length <input id="xoflen" type="number" min="8" max="8192" step="8" value="256"> bits</label>
</div>
<div class="note" id="err" role="alert"></div>
</section>

<section class="results" id="results" aria-live="polite"></section>
<p class="note">Check: SHA3-256("hello world") = <code>{HW['sha3_256']}</code>. More in the <a href="/test-vectors/">test vectors</a>.</p>

{buybox()}

<a class="card" href="/quantum-safe/" style="margin:24px 0;border-color:var(--accent)">
<b>New: is your website quantum-safe?</b>
<span>Check in seconds whether a site accepts post-quantum key exchange (ML-KEM), the NIST standard built on SHA-3. &rarr;</span>
</a>

<h2>Dedicated calculators</h2>
<div class="cards">
<a class="card" href="/sha3-256/"><b>SHA3-256</b><span>The most used SHA-3 size, 256-bit digest.</span></a>
<a class="card" href="/sha3-512/"><b>SHA3-512</b><span>Largest fixed digest, widest security margin.</span></a>
<a class="card" href="/keccak-256/"><b>Keccak-256</b><span>Ethereum and Solidity keccak256, function selectors.</span></a>
<a class="card" href="/shake256/"><b>SHAKE256</b><span>Extendable output: any length you need.</span></a>
</div>

<h2>Learn SHA-3</h2>
<div class="cards">
<a class="card" href="/what-is-sha3/"><b>What is SHA-3?</b><span>Keccak, the sponge construction and FIPS 202, explained.</span></a>
<a class="card" href="/sha3-vs-sha256/"><b>SHA-3 vs SHA-256</b><span>Design, security, speed and when to use which.</span></a>
<a class="card" href="/sha3-vs-keccak/"><b>SHA-3 vs Keccak-256</b><span>Why Ethereum hashes differ from NIST SHA-3.</span></a>
<a class="card" href="/code-examples/"><b>Code examples</b><span>Python, JavaScript, Go, Rust, Java, PHP, C#, OpenSSL.</span></a>
</div>

<h2>Frequently asked</h2>
{''.join(f'<h3>{html.escape(q)}</h3><p>{html.escape(a)}</p>' for q, a in home_faq)}
""", schema=[
    {'@context': 'https://schema.org', '@type': 'WebApplication', 'name': 'sha3.si SHA-3 hash calculator',
     'url': DOMAIN + '/calculator/', 'applicationCategory': 'DeveloperApplication', 'operatingSystem': 'Any (web browser)',
     'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
     'description': home_desc},
    faq_schema(home_faq),
], scripts='<script src="/assets/sha3.min.js"></script><script src="/assets/app.js"></script>')


# What is SHA-3
p = '/what-is-sha3/'
d = ('What SHA-3 is: the NIST FIPS 202 hash standard built on Keccak and the sponge construction. '
     'Output sizes, rate and capacity, SHAKE, and where SHA-3 is used today.')
PAGES[p] = page(p, 'What is SHA-3? Keccak, the sponge construction and FIPS 202 | sha3.si', d, f"""
<article>
<h1>What is SHA-3?</h1>
<p class="kicker">The short version: SHA-3 is the newest member of the Secure Hash Algorithm family, standardised by NIST in FIPS 202 (2015). It is built on Keccak, a design that works nothing like SHA-2, so the two families do not share weaknesses.</p>

<h2>Where it came from</h2>
<p>In 2007 NIST opened a public competition for a new hash function, as insurance in case attacks on MD5 and SHA-1 ever carried over to SHA-2. Sixty-four designs were submitted. In 2012 NIST chose <b>Keccak</b>, by Guido Bertoni, Joan Daemen, Michaël Peeters and Gilles Van Assche, and published it as SHA-3 in <b>FIPS 202</b> in August 2015.</p>
<p>SHA-3 was never a replacement for SHA-2, which remains secure. It is a second, independent standard, so the world has a well-tested fallback built on different mathematics.</p>

<h2>The sponge construction</h2>
<p>SHA-3 keeps a 1600-bit internal state and works in two phases:</p>
<ol>
<li><b>Absorbing.</b> The padded message is split into blocks. Each block is XORed into the first part of the state (the <i>rate</i>), then the whole state is scrambled by the Keccak-f[1600] permutation (24 rounds).</li>
<li><b>Squeezing.</b> Output is read from the rate part of the state, running the permutation again whenever more output is needed.</li>
</ol>
<p>The rest of the state, the <i>capacity</i>, is never directly touched by input or output. Its size sets the security level. Because the internal state is much larger than the output, SHA-3 is not vulnerable to the length-extension attacks that affect SHA-256 and SHA-512 when used naively as a MAC.</p>

<h2>The SHA-3 family</h2>
<div class="tablewrap"><table>
<tr><th>Function</th><th>Output</th><th>Rate (bits)</th><th>Capacity (bits)</th><th>Collision resistance</th></tr>
<tr><td>SHA3-224</td><td>224 bits</td><td>1152</td><td>448</td><td>112 bits</td></tr>
<tr><td>SHA3-256</td><td>256 bits</td><td>1088</td><td>512</td><td>128 bits</td></tr>
<tr><td>SHA3-384</td><td>384 bits</td><td>832</td><td>768</td><td>192 bits</td></tr>
<tr><td>SHA3-512</td><td>512 bits</td><td>576</td><td>1024</td><td>256 bits</td></tr>
<tr><td>SHAKE128</td><td>any length</td><td>1344</td><td>256</td><td>up to 128 bits</td></tr>
<tr><td>SHAKE256</td><td>any length</td><td>1088</td><td>512</td><td>up to 256 bits</td></tr>
</table></div>
<p><b>SHAKE128</b> and <b>SHAKE256</b> are extendable-output functions (XOFs): you choose how many bytes you want. NIST SP 800-185 builds more tools on the same core: cSHAKE, KMAC (a MAC), TupleHash and ParallelHash.</p>

<h2>Where SHA-3 is used</h2>
<ul>
<li><b>Post-quantum cryptography.</b> The new NIST standards ML-KEM (FIPS 203) and ML-DSA (FIPS 204) use SHA3-256, SHA3-512, SHAKE128 and SHAKE256 internally, so SHA-3 is in the core of the next generation of public-key cryptography.</li>
<li><b>Blockchains.</b> Ethereum uses Keccak-256 (the pre-standard version) for addresses, transaction hashes and storage. See <a href="/sha3-vs-keccak/">SHA-3 vs Keccak</a>.</li>
<li><b>Libraries and protocols.</b> SHA-3 is available in OpenSSL, the Python and Go standard libraries, Java, .NET, PHP and Node.js. See the <a href="/code-examples/">code examples</a>.</li>
</ul>

<h2>Example</h2>
<p>SHA3-256("hello world"):</p>
{code(HW['sha3_256'])}
<p>Try your own input in the <a href="/?q=hello%20world">calculator</a>.</p>
{buybox()}
</article>
""", schema=[article_schema(p, 'What is SHA-3?', d)])


# SHA-3 vs SHA-256
p = '/sha3-vs-sha256/'
d = ('SHA-3 vs SHA-256 compared: design (sponge vs Merkle-Damgard), security, length extension, speed, '
     'and which one to choose.')
cmp_faq = [
    ('Is SHA-3 more secure than SHA-256?',
     'Both are considered secure with no practical attacks. SHA3-256 and SHA-256 give the same 128-bit collision resistance. '
     'SHA-3 has a different design and is immune to length-extension attacks.'),
    ('Is SHA-3 faster than SHA-256?',
     'In software on common CPUs, SHA-256 is usually faster, especially with SHA hardware instructions. SHA-3 is very efficient in hardware.'),
    ('Should I switch from SHA-256 to SHA-3?',
     'Not for security reasons alone. Choose SHA-3 when a standard or protocol requires it, when you need an XOF (SHAKE), or when you want design diversity.'),
]
PAGES[p] = page(p, 'SHA-3 vs SHA-256: differences, security and speed | sha3.si', d, f"""
<article>
<h1>SHA-3 vs SHA-256</h1>
<p class="kicker">Both are secure, standardised and widely supported. They differ in design, not in strength, and that difference is the whole point.</p>

<div class="tablewrap"><table>
<tr><th></th><th>SHA-256 (SHA-2)</th><th>SHA3-256 (SHA-3)</th></tr>
<tr><td>Standard</td><td>FIPS 180-4</td><td>FIPS 202</td></tr>
<tr><td>Published</td><td>2001</td><td>2015</td></tr>
<tr><td>Design</td><td>Merkle-Damgard with a Davies-Meyer compression function</td><td>Sponge construction on the Keccak-f[1600] permutation</td></tr>
<tr><td>Output</td><td>256 bits</td><td>256 bits</td></tr>
<tr><td>Collision resistance</td><td>128 bits</td><td>128 bits</td></tr>
<tr><td>Length-extension attack</td><td>Vulnerable when misused as a MAC (use HMAC)</td><td>Not vulnerable</td></tr>
<tr><td>Variable-length output</td><td>No</td><td>Yes, via SHAKE128 / SHAKE256</td></tr>
<tr><td>Software speed</td><td>Usually faster, with dedicated CPU instructions</td><td>Usually slower in software, fast in hardware</td></tr>
<tr><td>Typical use</td><td>TLS, Bitcoin, code signing, general hashing</td><td>Post-quantum standards, protocols that need an XOF, design diversity</td></tr>
</table></div>

<h2>Same input, unrelated outputs</h2>
<p>"hello world" through each function:</p>
<div class="tablewrap"><table>
<tr><th>Function</th><th>Digest (hex)</th></tr>
<tr><td>SHA-256</td><td class="mono"><code>{HW['sha256']}</code></td></tr>
<tr><td>SHA3-256</td><td class="mono"><code>{HW['sha3_256']}</code></td></tr>
<tr><td>Keccak-256</td><td class="mono"><code>{HW['keccak256']}</code></td></tr>
</table></div>

<h2>Which should you use?</h2>
<ul>
<li><b>Use SHA-256</b> when you need maximum compatibility and speed on ordinary CPUs, or when a protocol (TLS, Bitcoin) already fixes it.</li>
<li><b>Use SHA-3</b> when a standard requires it (for example the post-quantum ML-KEM and ML-DSA), when you need a variable-length output (SHAKE), or when you want a hash with a completely different design from SHA-2.</li>
<li><b>For a MAC</b>, use HMAC-SHA-256 or KMAC. Never hash(key + message) with SHA-256.</li>
</ul>

<h2>Frequently asked</h2>
{''.join(f'<h3>{html.escape(q)}</h3><p>{html.escape(a)}</p>' for q, a in cmp_faq)}
{buybox()}
</article>
""", schema=[article_schema(p, 'SHA-3 vs SHA-256', d), faq_schema(cmp_faq)])


# SHA-3 vs Keccak
p = '/sha3-vs-keccak/'
d = ('Why Ethereum Keccak-256 and NIST SHA3-256 give different hashes for the same input: the padding byte, '
     'with examples and how to compute each.')
kec_faq = [
    ('Is Ethereum keccak256 the same as SHA3-256?',
     'No. Ethereum uses the original Keccak submission padding (domain byte 0x01). NIST SHA3-256 adds two domain bits (byte 0x06). The outputs are completely different.'),
    ('Which libraries give Ethereum-compatible Keccak-256?',
     'Use functions explicitly named keccak256 or Keccak-256: ethers.js and web3.js keccak256, pycryptodome Crypto.Hash.keccak, Go golang.org/x/crypto/sha3 NewLegacyKeccak256, the Rust sha3 crate Keccak256.'),
]
PAGES[p] = page(p, 'SHA-3 vs Keccak-256: why Ethereum hashes differ | sha3.si', d, f"""
<article>
<h1>SHA-3 vs Keccak-256</h1>
<p class="kicker">The most common SHA-3 bug in blockchain code: calling a SHA3-256 function when Ethereum expects Keccak-256. Same algorithm core, one different padding byte, totally different result.</p>

<h2>The one difference</h2>
<p>Keccak won the NIST competition in 2012. When NIST published the final standard (FIPS 202, 2015), it added <b>domain-separation bits</b> to the padding so SHA-3 and SHAKE outputs can never collide with each other:</p>
<div class="tablewrap"><table>
<tr><th>Variant</th><th>Padding starts with</th><th>Used by</th></tr>
<tr><td>Keccak-256 (original)</td><td><code>0x01</code></td><td>Ethereum and EVM chains (addresses, tx hashes, function selectors)</td></tr>
<tr><td>SHA3-256 (FIPS 202)</td><td><code>0x06</code></td><td>NIST standard, OpenSSL, Python hashlib, Java, .NET</td></tr>
<tr><td>SHAKE128 / SHAKE256</td><td><code>0x1F</code></td><td>NIST XOFs, post-quantum standards</td></tr>
</table></div>
<p>Ethereum's design was fixed before FIPS 202 was final, so it kept the original padding. Many Ethereum libraries still call it "sha3", which is where the confusion comes from: Solidity's old <code>sha3()</code> was an alias of <code>keccak256()</code>.</p>

<h2>Proof, with real digests</h2>
<div class="tablewrap"><table>
<tr><th>Input</th><th>Keccak-256 (Ethereum)</th><th>SHA3-256 (NIST)</th></tr>
<tr><td>"" (empty)</td><td class="mono"><code>{V['']['keccak256']}</code></td><td class="mono"><code>{V['']['sha3_256']}</code></td></tr>
<tr><td>"abc"</td><td class="mono"><code>{V['abc']['keccak256']}</code></td><td class="mono"><code>{V['abc']['sha3_256']}</code></td></tr>
<tr><td>"hello world"</td><td class="mono"><code>{HW['keccak256']}</code></td><td class="mono"><code>{HW['sha3_256']}</code></td></tr>
</table></div>
<p>If your empty-string hash starts with <code>c5d24601</code>, you have Keccak-256. If it starts with <code>a7ffc6f8</code>, you have SHA3-256.</p>

<h2>Computing each</h2>
{code('''# Python: NIST SHA3-256
import hashlib
hashlib.sha3_256(b"abc").hexdigest()

# Python: Ethereum Keccak-256 (pip install pycryptodome)
from Crypto.Hash import keccak
k = keccak.new(digest_bits=256)
k.update(b"abc")
k.hexdigest()''')}
{code('''// JavaScript (ethers v6): Ethereum Keccak-256
import { keccak256, toUtf8Bytes } from "ethers";
keccak256(toUtf8Bytes("abc"));

// Node.js: NIST SHA3-256
import { createHash } from "node:crypto";
createHash("sha3-256").update("abc").digest("hex");''')}

<h2>Frequently asked</h2>
{''.join(f'<h3>{html.escape(q)}</h3><p>{html.escape(a)}</p>' for q, a in kec_faq)}
{buybox()}
</article>
""", schema=[article_schema(p, 'SHA-3 vs Keccak-256', d), faq_schema(kec_faq)])


# Test vectors
p = '/test-vectors/'
d = ('SHA-3 test vectors: SHA3-224, SHA3-256, SHA3-384, SHA3-512, SHAKE128, SHAKE256 and Keccak-256 '
     'digests for common inputs, to verify your implementation.')
rows = ''
for m in MSGS:
    v = V[m]
    label = '"" (empty string)' if m == '' else f'"{html.escape(m)}"'
    rows += f'<h3>{label}</h3><div class="tablewrap"><table>'
    for k, n in [('sha3_224', 'SHA3-224'), ('sha3_256', 'SHA3-256'), ('sha3_384', 'SHA3-384'), ('sha3_512', 'SHA3-512'),
                 ('shake128_256', 'SHAKE128, 256-bit output'), ('shake256_512', 'SHAKE256, 512-bit output'),
                 ('keccak256', 'Keccak-256 (Ethereum)')]:
        rows += f'<tr><td>{n}</td><td class="mono"><code>{v[k]}</code></td></tr>'
    rows += '</table></div>'
PAGES[p] = page(p, 'SHA-3 test vectors: SHA3-256, SHA3-512, SHAKE, Keccak-256 | sha3.si', d, f"""
<article>
<h1>SHA-3 test vectors</h1>
<p class="kicker">Known-answer digests for checking a SHA-3 implementation. Inputs are UTF-8 strings, outputs are lowercase hex. Generated with Python's hashlib (OpenSSL) and cross-checked against js-sha3.</p>
{rows}
<p>For the full official set, see the NIST Cryptographic Algorithm Validation Program (CAVP) SHA-3 test vectors.</p>
{buybox()}
</article>
""", schema=[article_schema(p, 'SHA-3 test vectors', d)])


# Code examples
p = '/code-examples/'
d = ('How to compute SHA-3 (SHA3-256, SHA3-512, SHAKE) in Python, JavaScript, Node.js, Go, Rust, Java, PHP, C# '
     'and the OpenSSL command line.')
PAGES[p] = page(p, 'SHA-3 code examples: Python, JavaScript, Go, Rust, Java, PHP, C#, OpenSSL | sha3.si', d, f"""
<article>
<h1>SHA-3 code examples</h1>
<p class="kicker">SHA3-256 of the string "hello world" in every common language. Every snippet should print <code>{HW['sha3_256']}</code>.</p>

<h2>Python</h2>
{code('''import hashlib

print(hashlib.sha3_256(b"hello world").hexdigest())
print(hashlib.shake_256(b"hello world").hexdigest(32))  # SHAKE256, 32-byte output''')}

<h2>Node.js</h2>
{code('''import { createHash } from "node:crypto";

console.log(createHash("sha3-256").update("hello world").digest("hex"));''')}

<h2>JavaScript in the browser</h2>
<p>The Web Crypto API does not include SHA-3, so use a library such as js-sha3 (the one this site uses):</p>
{code('''import { sha3_256, keccak256 } from "js-sha3";

sha3_256("hello world");   // NIST SHA3-256
keccak256("hello world");  // Ethereum Keccak-256''')}

<h2>Go</h2>
{code('''package main

import (
    "crypto/sha3" // Go 1.24+; older versions: golang.org/x/crypto/sha3
    "fmt"
)

func main() {
    fmt.Printf("%x", sha3.Sum256([]byte("hello world")))
}''')}

<h2>Rust</h2>
{code('''// Cargo.toml: sha3 = "0.10", hex = "0.4"
use sha3::{Digest, Sha3_256};

fn main() {
    let hash = Sha3_256::digest(b"hello world");
    println!("{}", hex::encode(hash));
}''')}

<h2>Java</h2>
{code('''import java.security.MessageDigest;
import java.util.HexFormat;

byte[] h = MessageDigest.getInstance("SHA3-256")
        .digest("hello world".getBytes(java.nio.charset.StandardCharsets.UTF_8));
System.out.println(HexFormat.of().formatHex(h)); // Java 17+''')}

<h2>PHP</h2>
{code('''<?php
echo hash('sha3-256', 'hello world');''')}

<h2>C# (.NET 8+)</h2>
{code('''using System.Security.Cryptography;
using System.Text;

if (SHA3_256.IsSupported)
{
    byte[] h = SHA3_256.HashData(Encoding.UTF8.GetBytes("hello world"));
    Console.WriteLine(Convert.ToHexString(h).ToLowerInvariant());
}''')}

<h2>OpenSSL command line</h2>
{code('''printf "hello world" | openssl dgst -sha3-256
openssl dgst -sha3-512 myfile.bin''')}
<p>Need Ethereum-compatible hashes instead? See <a href="/sha3-vs-keccak/">SHA-3 vs Keccak-256</a>.</p>
{buybox()}
</article>
""", schema=[article_schema(p, 'SHA-3 code examples', d)])


# Algorithm pages: one per most-searched name, each with its own calculator
# (that row lifted to the top), its own facts and its own known answers.
def calc_panel(sample):
    return f"""<section class="panel" aria-label="SHA-3 calculator">
<div class="tabs">
<button type="button" data-tab="text" class="on">Text</button>
<button type="button" data-tab="file">File</button>
</div>
<div id="pane-text">
<textarea id="in" spellcheck="false" aria-label="Input to hash">{html.escape(sample)}</textarea>
</div>
<div id="pane-file" class="hidden">
<div id="drop" class="drop">Drop a file here, or click to choose one.<br><small>The file is read in your browser and never uploaded.</small></div>
<input id="file" type="file" class="hidden">
<div class="note" id="fileinfo"></div>
</div>
<div class="opts">
<label>Input <select id="mode"><option value="text">UTF-8 text</option><option value="hex">Hex bytes</option></select></label>
<label>Output <select id="fmt"><option value="hex">hex</option><option value="HEX">HEX</option><option value="b64">Base64</option></select></label>
<label>SHAKE length <input id="xoflen" type="number" min="8" max="8192" step="8" value="256"> bits</label>
</div>
<div class="note" id="err" role="alert"></div>
</section>
<section class="results" id="results" aria-live="polite"></section>"""

CALC_JS = '<script src="/assets/sha3.min.js"></script><script src="/assets/app.js"></script>'
SELECTOR_SIG = 'transfer(address,uint256)'
SELECTOR = keccak256([SELECTOR_SIG])[0]
assert SELECTOR.startswith('a9059cbb'), SELECTOR  # the well-known ERC-20 transfer selector

ALGO_PAGES = [
    dict(path='/sha3-256/', focus='sha3_256', name='SHA3-256',
         title='SHA3-256 Hash Generator Online: free SHA3-256 calculator | sha3.si',
         desc='Free online SHA3-256 hash generator. Hash text, hex or files with SHA3-256 (FIPS 202) in your browser, '
              'with test vectors and code examples.',
         intro='SHA3-256 is the 256-bit member of the SHA-3 family (NIST FIPS 202). It is the most widely used SHA-3 '
               'output size and the direct counterpart of SHA-256.',
         facts=[('Output', '256 bits (64 hex characters)'), ('Rate / capacity', '1088 / 512 bits'),
                ('Collision resistance', '128 bits'), ('Preimage resistance', '256 bits'),
                ('Standard', 'NIST FIPS 202 (2015)')],
         uses='Used inside ML-KEM (FIPS 203), the new post-quantum key-encapsulation standard, and anywhere a protocol '
              'asks for "SHA3-256" by name. If you need Ethereum compatibility, you want <a href="/keccak-256/">Keccak-256</a> instead.',
         key='sha3_256',
         snippet='''import hashlib
hashlib.sha3_256(b"hello world").hexdigest()'''),
    dict(path='/sha3-512/', focus='sha3_512', name='SHA3-512',
         title='SHA3-512 Hash Generator Online: free SHA3-512 calculator | sha3.si',
         desc='Free online SHA3-512 hash generator. Compute SHA3-512 digests of text, hex or files locally in your '
              'browser, with known-answer test vectors.',
         intro='SHA3-512 is the largest fixed-size SHA-3 function: a 512-bit digest with the highest security margin '
               'in the family.',
         facts=[('Output', '512 bits (128 hex characters)'), ('Rate / capacity', '576 / 1024 bits'),
                ('Collision resistance', '256 bits'), ('Preimage resistance', '512 bits'),
                ('Standard', 'NIST FIPS 202 (2015)')],
         uses='ML-KEM (FIPS 203) uses SHA3-512 as its G function. Choose SHA3-512 when you want the widest security '
              'margin, for example long-term archives or very high-value signatures.',
         key='sha3_512',
         snippet='''import hashlib
hashlib.sha3_512(b"hello world").hexdigest()'''),
    dict(path='/keccak-256/', focus='keccak256', name='Keccak-256',
         title='Keccak-256 Hash Online: Ethereum keccak256 calculator | sha3.si',
         desc='Free online Keccak-256 hash calculator, compatible with Ethereum and Solidity keccak256. '
              'Compute function selectors and hashes in your browser.',
         intro='Keccak-256 is the original Keccak submission with a 256-bit output, before NIST changed the padding '
               'for SHA-3. Ethereum and every EVM chain use it, which is why it gives different results from SHA3-256.',
         facts=[('Output', '256 bits'), ('Padding byte', '0x01 (SHA3-256 uses 0x06)'),
                ('Used by', 'Ethereum, Solidity keccak256(), EVM chains'),
                (f'Function selector of {SELECTOR_SIG}', f'0x{SELECTOR[:8]} (first 4 bytes of the hash)')],
         uses='Ethereum uses Keccak-256 for addresses (the last 20 bytes of the hash of the public key), transaction '
              'hashes, storage slots and the 4-byte function selectors that every contract call starts with. '
              'Type <code>transfer(address,uint256)</code> above and the first 8 hex characters are the selector.',
         key='keccak256',
         snippet='''// ethers v6
import { keccak256, toUtf8Bytes } from "ethers";
keccak256(toUtf8Bytes("hello world"));'''),
    dict(path='/shake256/', focus='shake256', name='SHAKE256',
         title='SHAKE256 Online: extendable-output SHA-3 calculator | sha3.si',
         desc='Free online SHAKE256 and SHAKE128 calculator. Choose any output length and hash text, hex or files '
              'in your browser.',
         intro='SHAKE256 is an extendable-output function (XOF) from the SHA-3 family: instead of a fixed digest, '
               'you ask for exactly as many bits as you need, with up to 256-bit security.',
         facts=[('Output', 'any length you choose'), ('Rate / capacity', '1088 / 512 bits'),
                ('Security', 'up to 256 bits (collision: min(d/2, 256))'), ('Standard', 'NIST FIPS 202 (2015)'),
                ('Sibling', 'SHAKE128: rate 1344, up to 128-bit security')],
         uses='SHAKE256 is used in Ed448 signatures (RFC 8032), in ML-DSA and ML-KEM, and in the SHAKE variants of '
              'SLH-DSA. Set the output length above to the size your protocol needs.',
         key='shake256_512', key_label='SHAKE256 with a 512-bit output',
         snippet='''import hashlib
hashlib.shake_256(b"hello world").hexdigest(64)  # 64 bytes = 512 bits'''),
]

for a in ALGO_PAGES:
    vrows = ''.join(f'<tr><td>{"&quot;&quot; (empty)" if m == "" else "&quot;" + html.escape(m) + "&quot;"}</td>'
                    f'<td class="mono"><code>{V[m][a["key"]]}</code></td></tr>' for m in MSGS[:3])
    facts = ''.join(f'<tr><th>{k}</th><td>{v}</td></tr>' for k, v in a['facts'])
    sample = SELECTOR_SIG if a['focus'] == 'keccak256' else 'hello world'
    others = ' &middot; '.join(f'<a href="{h}">{t}</a>' for h, t in ALGO_LINKS if h != a['path'])
    faq = [(f'Is the {a["name"]} calculator private?',
            'Yes. The hash is computed in your browser; nothing you type or drop is uploaded.'),
           (f'What is the {a["name"]} of an empty string?',
            f'{a.get("key_label", a["name"])} of "" = {V[""][a["key"]]}')]
    PAGES[a['path']] = page(a['path'], a['title'], a['desc'], f"""
<section class="hero">
<h1>{a['name']} hash calculator</h1>
<p class="lead">{a['intro']}</p>
</section>
{calc_panel(sample)}
<article>
<h2>{a['name']} at a glance</h2>
<div class="tablewrap"><table>{facts}</table></div>
<h2>Where it is used</h2>
<p>{a['uses']}</p>
<h2>Known answers</h2>
<p>{a.get('key_label', a['name'])}:</p>
<div class="tablewrap"><table><tr><th>Input</th><th>Digest (hex)</th></tr>{vrows}</table></div>
<h2>In code</h2>
{code(a['snippet'])}
<p>More languages: <a href="/code-examples/">SHA-3 code examples</a>. Other calculators: {others}.</p>
<h2>Frequently asked</h2>
{''.join(f'<h3>{html.escape(q)}</h3><p>{html.escape(t)}</p>' for q, t in faq)}
{buybox()}
</article>
""", schema=[{'@context': 'https://schema.org', '@type': 'WebApplication', 'name': f'{a["name"]} hash calculator',
              'url': DOMAIN + a['path'], 'applicationCategory': 'DeveloperApplication',
              'operatingSystem': 'Any (web browser)', 'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
              'description': a['desc']}, faq_schema(faq)],
        scripts=CALC_JS, focus=a['focus'])


# Quantum-safety checker page (front end; the work happens in checker/).
p = '/quantum-safe/'
d = ('Is your website quantum-safe? Free check: does your server accept post-quantum key exchange (ML-KEM, '
     'X25519MLKEM768)? TLS version, certificate and how to fix it, in seconds.')
qs_faq = [
    ('What does "quantum-safe" mean for a website?',
     'That the key exchange protecting its HTTPS traffic uses post-quantum cryptography (ML-KEM, FIPS 203), usually as the '
     'hybrid X25519MLKEM768. Traffic recorded today then cannot be decrypted later by a quantum computer.'),
    ('Why does it matter now if quantum computers cannot break encryption yet?',
     'Because of harvest now, decrypt later: encrypted traffic can be recorded today and decrypted once a large quantum '
     'computer exists. Data that must stay secret for years needs post-quantum protection already.'),
    ('Why is my certificate still classical?',
     'Public certificate authorities do not issue post-quantum (ML-DSA) certificates yet. Key exchange is the part to fix '
     'first, because it protects recorded traffic; signatures only need to be quantum-safe once quantum computers exist.'),
    ('Is the check safe for my server?',
     'Yes. It opens two ordinary HTTPS handshakes on port 443, like a browser visiting your homepage, and sends no requests '
     'beyond that. Results are cached for ten minutes and the site you check is not stored.'),
    ('How do I enable post-quantum key exchange?',
     'Cloudflare enables it by default. Go 1.24+ servers and Caddy built with Go 1.24+ also do. With nginx or Apache, build '
     'against OpenSSL 3.5 or later and put X25519MLKEM768 first in the key-exchange groups.'),
]
PAGES[p] = page(p, 'Is your website quantum-safe? Free post-quantum TLS check (ML-KEM) | sha3.si', d, f"""
<section class="hero">
<h1>Is your website quantum-safe?</h1>
<p class="lead">Check whether a site accepts post-quantum key exchange (ML-KEM, the NIST FIPS 203 standard) and protects its traffic against harvest-now, decrypt-later attacks. Free, in seconds.</p>
</section>

<section class="panel">
<form id="qs-form" class="qs-form" data-api="{CHECKER_URL}" autocomplete="off">
<label for="qs-host" class="hidden">Website</label>
<input id="qs-host" type="text" inputmode="url" spellcheck="false" placeholder="example.com" required>
<button id="qs-go" class="btn primary" type="submit">Check</button>
</form>
<p class="note">Try: <a href="#" data-try="cloudflare.com">cloudflare.com</a> &middot; <a href="#" data-try="google.com">google.com</a> &middot; <a href="#" data-try="github.com">github.com</a></p>
</section>
<section id="qs-out" aria-live="polite"></section>

<article>
<h2>Why this matters</h2>
<p>Almost every HTTPS connection today agrees its keys with elliptic curves (X25519, P-256) or RSA. A large quantum computer running Shor's algorithm would break both. Nobody has one yet, but traffic can be <b>recorded now and decrypted later</b>, so data that must stay confidential for years is already at risk.</p>
<p>That is why NIST published the post-quantum standards <b>ML-KEM</b> (FIPS 203) and <b>ML-DSA</b> (FIPS 204) in 2024, and why governments have set migration timelines: NIST plans to deprecate today's public-key algorithms by 2030 and disallow them by 2035, and the UK and EU have published roadmaps aiming at 2030 to 2035 for critical systems.</p>

<h2>What this check tests</h2>
<div class="tablewrap"><table>
<tr><th>Test</th><th>How</th><th>Why</th></tr>
<tr><td><b>Post-quantum key exchange</b></td><td>We open a TLS 1.3 handshake offering <b>only</b> the hybrid group X25519MLKEM768. If the server completes it, it supports ML-KEM.</td><td>This is the part that protects recorded traffic. 2 points.</td></tr>
<tr><td>TLS 1.3</td><td>A normal handshake: which version does the server choose?</td><td>Post-quantum key exchange exists only in TLS 1.3. 1 point.</td></tr>
<tr><td>Certificate</td><td>Key type, signature, issuer, expiry and validity.</td><td>Shown for information. Post-quantum certificates are not issued by public CAs yet.</td></tr>
</table></div>
<p>X25519MLKEM768 combines classical X25519 with ML-KEM-768. An attacker would have to break <b>both</b>, so it is at least as strong as today's encryption, and safe against quantum computers. Chrome, Firefox, Safari and Edge already offer it.</p>

<h2>Where SHA-3 comes in</h2>
<p>ML-KEM is built on SHA-3: it uses <a href="/sha3-256/">SHA3-256</a>, <a href="/sha3-512/">SHA3-512</a>, SHAKE128 and <a href="/shake256/">SHAKE256</a> internally. Every post-quantum handshake this page detects runs SHA-3 under the hood.</p>

<h2>Frequently asked</h2>
{''.join(f'<h3>{html.escape(q)}</h3><p>{html.escape(a)}</p>' for q, a in qs_faq)}
{buybox()}
</article>
""", schema=[{'@context': 'https://schema.org', '@type': 'WebApplication',
              'name': 'Quantum-safe website check (post-quantum TLS)', 'url': DOMAIN + p,
              'applicationCategory': 'SecurityApplication', 'operatingSystem': 'Any (web browser)',
              'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'}, 'description': d},
             faq_schema(qs_faq)],
    scripts='<script src="/assets/qs.js"></script>')


# ---------------------------------------------------------------- MiCA service
# The product pages. The scan, payments and evidence API live in app/ (Vercel,
# Frankfurt); these pages are static and call it from the browser (assets/mica.js).
NOINDEX = {'/r/', '/account/'}
EXTRA_FILES = {}
MICA_JS = '<script src="/assets/mica.js" defer></script>'

DIALOGS = f"""
<dialog class="modal" id="lead-dialog">
<form id="lead-form" method="dialog" novalidate>
<h3>Send me the full report</h3>
<p class="note" id="lead-note"></p>
<label>Work email<input type="email" name="email" required autocomplete="email"></label>
<label>Name<input type="text" name="name" autocomplete="name"></label>
<label>Company<input type="text" name="company" autocomplete="organization"></label>
<label>Role<input type="text" name="role" placeholder="Compliance officer, MLRO, General Counsel..."></label>
<label>Message (optional)<textarea name="message" id="lead-msg"></textarea></label>
<input type="hidden" name="scan_id" id="lead-scan">
<label class="hp" aria-hidden="true">Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
<label class="check"><input type="checkbox" name="consent" required> I agree that sha3.si may email me about this request. See the <a href="/privacy/">privacy notice</a>.</label>
<p class="form-err" id="lead-err" role="alert"></p>
<div class="row-end"><button type="button" class="btn" id="lead-close">Close</button><button type="submit" class="btn primary">Send</button></div>
</form>
<div class="ok" id="lead-ok" hidden><h3>Thank you</h3><p>We reply from {CONTACT}, normally the same working day.</p></div>
</dialog>
<dialog class="modal" id="buy-dialog">
<form id="buy-form" method="dialog" novalidate>
<h3>Order</h3>
<p><b id="buy-plan"></b></p>
<label>Work email (for the invoice and the report)<input type="email" name="email" required autocomplete="email"></label>
<label>Website to audit or monitor<input type="text" name="host" required placeholder="example.com" inputmode="url"></label>
<input type="hidden" name="plan"><input type="hidden" name="scan_id">
<p class="note">Payment by card through Stripe. Prices exclude VAT; EU business customers add their VAT number at checkout (reverse charge). Billed by {COMPANY}.</p>
<p class="form-err" id="buy-err" role="alert"></p>
<div class="row-end"><button type="button" class="btn" id="buy-close">Cancel</button><button type="submit" class="btn primary">Continue to payment</button></div>
</form>
</dialog>"""

check_cards = ''.join(
    f'<div class="card"><b>{html.escape(c["title"])}</b><span>{html.escape(c["what"])}</span>'
    f'<span class="rep-ref">{html.escape(c["ref"])}</span></div>' for c in CHECKLIST['checks'])

mica_faq = [
    ('Is this legal advice?',
     'No. sha3.si records what your website showed, when, and from where, and explains which MiCA duty each finding relates to. '
     'Whether something is a breach is for your compliance team, your counsel and your supervisor to decide.'),
    ('Who runs sha3.si?',
     f'sha3.si is a service of {COMPANY}, a Wyoming (USA) company. Scans run on servers in Frankfurt am Main, Germany. '
     'We are not a law firm, and we never hold, move or exchange crypto-assets.'),
    ('What does the free scan read?',
     'Your homepage, robots.txt and sitemap, up to six legal or disclosure pages linked from the homepage, the disclosure pages it finds, '
     'and one asset page when it looks for white papers: about twenty requests, made like a desktop browser. It never submits a form '
     'and never clicks a consent banner.'),
    ('Why "two clicks"?',
     'MiCA asks for fee and climate disclosures "in a prominent place" on the website. The Dutch AFM, reviewing crypto firms in 2026, '
     'looked for cost information within one or two clicks of the homepage. We use the same yardstick.'),
    ('What does Claude do?',
     "Claude, Anthropic's AI model, reads the public text of the pages the scanner found and judges what they say against each duty: "
     'is the fee page a real policy, does the climate page give indicators per crypto-asset, does the complaints page offer a template. '
     'It quotes your page exactly and says "unclear" when the text does not allow a judgment. No personal data is sent to it.'),
    ('Can I check the evidence without trusting you?',
     'Yes. Every page we read has a SHA3-256 fingerprint of the exact bytes received, every report is sealed with its own fingerprint, '
     'and each day the fingerprints are folded into a Merkle tree whose root is timestamped in Bitcoin through OpenTimestamps. '
     'The verification page recomputes the Merkle proof in your browser, and the open-source ots client checks the Bitcoin proof.'),
    ('My site is built with JavaScript. Does the scan still work?',
     'The free scan reads the HTML your server sends, so menus drawn later by JavaScript can be missed; the report says so when it happens. '
     'The paid audit adds a full browser pass.'),
    ('What do you store?',
     'The public pages we fetched, the reports, and their fingerprints. Your email and name only if you send them to us. '
     'Your IP address is never stored in clear: a salted hash is kept for an hour to stop abuse. No cookies, no tracking.'),
]

PAGES['/'] = page('/', 'MiCA website check for crypto firms: free scan from Frankfurt | sha3.si',
    'Free MiCA website scan for EU crypto-asset service providers: fee policy, climate disclosures, complaints, risk warnings and white papers, '
    'checked two clicks deep from Frankfurt, reviewed by Claude, every page fingerprinted with SHA3-256 and anchored in Bitcoin.', f"""
<section class="hero mica" id="scan">
<span class="kicker-tag"><i></i>MiCA website evidence &middot; read from Frankfurt</span>
<h1>See your website the way your <em>supervisor</em> does.</h1>
<p class="lead">sha3.si reads a crypto firm's site from inside the EU, two clicks deep, and checks every disclosure MiCA asks for. Claude then judges what each page actually says. Every page is fingerprinted with SHA3-256 and anchored in Bitcoin, so the evidence still stands months later.</p>
<div class="scan-panel">
<form id="scan-form" class="scan-form" autocomplete="off" role="search">
<label for="scan-url" class="hidden">Firm name or website</label>
<input id="scan-url" type="text" inputmode="url" spellcheck="false" placeholder="Firm name or website, e.g. coinhouse.com" aria-autocomplete="list" aria-controls="scan-suggest" required>
<ul id="scan-suggest" class="suggest" role="listbox" hidden></ul>
<button class="btn primary" type="submit">Scan free</button>
</form>
<p class="scan-hint">Free, no sign-up, about a minute. Search the {REGISTER_COUNT} firms in ESMA's MiCA register (as of {REGISTER_AS_OF}) or type any website. Try:<a href="#" data-try="coinhouse.com">coinhouse.com</a><a href="#" data-try="weareblox.com">weareblox.com</a><a href="#" data-try="criptan.com">criptan.com</a></p>
</div>
<div id="scan-out" hidden></div>
</section>

<section class="band">
<h2>The grace period is over</h2>
<p class="sub">MiCA's transitional period ended on 1 July 2026. Supervisors have moved from guidance to letters and fines, and the website is the first thing they read.</p>
<div class="stats">
<div class="stat"><b>19 of 33</b><span>crypto firms reviewed by the Dutch AFM had significant failures in their cost information. "The period of leniency has ended." <a href="https://www.afm.nl/en/sector/actueel/2026/apr/pb-reclame-informatie-casps" rel="noopener" target="_blank">AFM, 16 April 2026</a></span></div>
<div class="stat"><b>25 of 52</b><span>Dutch and Maltese firms in ESMA's register had at least one required disclosure our scanner could not reach within two clicks of the homepage. Screening, November 2026.</span></div>
<div class="stat"><b>&euro;70,000</b><span>Austria's first binding MiCA penalty, for marketing communications and a late white paper. <a href="https://www.crowdfundinsider.com/2026/08/297983-austrias-financial-market-authority-fma-issues-first-binding-mica-penalty-against-bitpanda/" rel="noopener" target="_blank">FMA, August 2026</a></span></div>
</div>
</section>

<section class="band">
<h2>What we check</h2>
<p class="sub">Eight website duties from MiCA and ESMA, each with the article it comes from. Full explanations in the <a href="/mica-checklist/">MiCA website checklist</a>.</p>
<div class="checklist">{check_cards}</div>
</section>

<section class="band">
<h2>Evidence that holds up</h2>
<p class="sub">A screenshot proves little. A fingerprint anchored in a public blockchain proves the page looked exactly like this, on this date.</p>
<div class="chain">
<div><b>Read from Frankfurt</b><span>Every request leaves a server in Frankfurt am Main, so the scan sees the EU version of your site, geo-routing and cookie walls included.</span></div>
<div><b>Fingerprinted</b><span>The exact bytes of every page get a SHA3-256 fingerprint, the NIST hash standard this site is named after.</span></div>
<div><b>Sealed</b><span>Each report gets its own fingerprint, and every day's reports are folded into one Merkle tree.</span></div>
<div><b>Anchored in Bitcoin</b><span>The day's root is timestamped through OpenTimestamps. Anyone can verify it later, without trusting us. No wallet, no tokens.</span></div>
</div>
<p class="note"><a href="/evidence/">Verify a record yourself &rarr;</a></p>
</section>

<section class="band" id="pricing">
<h2>Pricing</h2>
<p class="sub">Start free. Pay when you want a person to check every finding, or a weekly watch on your site.</p>
<div class="pricing">
<div class="plan">
<h3>Free scan</h3>
<div class="price">&euro;0</div>
<ul>
<li>Eight MiCA website checks, two clicks deep, from Frankfurt</li>
<li>Claude's reading of your disclosure pages, for firms in ESMA's register while the day's capacity lasts</li>
<li>Private report link, with every page fingerprinted</li>
</ul>
<a class="btn" href="#scan">Scan now</a>
</div>
<div class="plan featured">
<h3>MiCA website audit</h3>
<div class="price">&euro;1,490 <small>one-off</small></div>
<ul>
<li>A browser-rendered pass over your whole disclosure path</li>
<li>Every finding checked by a person against the regulation</li>
<li>Replacement wording, written in your site's language</li>
<li>Evidence pack: fingerprints, Merkle proofs, Bitcoin anchors</li>
<li>Delivered within 48 hours</li>
</ul>
<button type="button" class="btn primary" data-plan="audit">Order the audit</button>
</div>
<div class="plan">
<h3>Monitor</h3>
<div class="price">&euro;290 <small>per month</small></div>
<ul>
<li>A fresh scan from Frankfurt every week</li>
<li>An email when a disclosure link breaks or a page changes</li>
<li>A tamper-evident evidence log to show your supervisor</li>
<li>An evidence pack you can download at any time: every record, its Merkle proof and its Bitcoin anchor</li>
</ul>
<div class="plan-btns"><button type="button" class="btn primary" data-plan="monitor_month">Monthly</button><button type="button" class="btn" data-plan="monitor_year">&euro;2,900 a year, audit included</button></div>
</div>
</div>
<p class="note">Prices exclude VAT. EU business customers: reverse charge, add your VAT number at checkout. Billed by {COMPANY} through Stripe. Several brands or websites? <a href="#" data-lead="group">Ask for a group price</a>.</p>
</section>

<section class="band">
<h2>Frequently asked</h2>
{''.join(f'<h3>{html.escape(q)}</h3><p>{html.escape(a)}</p>' for q, a in mica_faq)}
</section>
{DIALOGS}
""", schema=[
    {'@context': 'https://schema.org', '@type': 'WebApplication', 'name': 'sha3.si MiCA website scan',
     'url': DOMAIN + '/', 'applicationCategory': 'BusinessApplication', 'operatingSystem': 'Any (web browser)',
     'offers': [{'@type': 'Offer', 'name': 'Free scan', 'price': '0', 'priceCurrency': 'EUR'},
                {'@type': 'Offer', 'name': 'MiCA website audit', 'price': '1490', 'priceCurrency': 'EUR'},
                {'@type': 'Offer', 'name': 'Monitor (monthly)', 'price': '290', 'priceCurrency': 'EUR'}],
     'provider': org()},
    faq_schema(mica_faq),
], scripts=MICA_JS)


# The checklist, explained: the page people find when they search for MiCA's website rules.
p = '/mica-checklist/'
d = ('What MiCA requires on a crypto firm\'s website: pricing and fees policy, climate disclosures per crypto-asset, complaints '
     'procedure and template, risk warnings, white-paper links and the line between regulated and unregulated services.')
duty_text = {
    'licence': 'Information to clients must be fair, clear and not misleading, and marketing must be recognisable as marketing (Art. 66(2)). '
               'ESMA expects authorised firms to say they are authorised, and by whom, and not to let that status cover services outside MiCA.',
    'fees': 'Firms must make their policies on pricing, costs and fees public, in a prominent place on their website (Art. 66(4)). '
            'A sales page that promises "low fees" is not a policy: say how prices are formed (spreads, mark-ups), which fees apply to which service, and how changes are announced.',
    'sustainability': 'Firms must publish, in a prominent place on their website, the principal adverse climate and environmental impacts of the consensus mechanism '
                      'behind each crypto-asset they serve (Art. 66(5)). Commission Delegated Regulation (EU) 2025/422 sets the indicators, such as energy consumption, '
                      'renewable share and emissions, and the reporting period. A corporate environmental policy does not replace per-asset indicators.',
    'complaints': 'Firms must have and publish a complaints-handling procedure, let clients complain free of charge, tell them they can complain, and make a complaint '
                  'template available (Art. 71(1)-(3)). Commission Delegated Regulation (EU) 2025/294 adds the detail on the procedure and the template.',
    'whitepapers': 'Firms that run a trading platform, exchange crypto-assets for funds or other crypto-assets, give advice or manage portfolios must give clients '
                   'hyperlinks to the white papers of the crypto-assets they provide those services for (Art. 66(3)).',
    'risk': 'Firms must warn clients of the risks of crypto-asset transactions (Art. 66(3)). A warning hidden in the footer while the page above promotes a yield '
            'is the pattern supervisors keep pointing to.',
    'unregulated': 'Some staking, lending, earn and DeFi products fall outside MiCA. ESMA has warned firms not to present them under their MiCA authorisation, '
                   'and to label them clearly as outside it (ESMA35-1872330276-2329).',
    'register': "ESMA's interim register lists each authorised firm with its website. When that address does not open the firm's own site, or the site never names "
                'the registered legal entity, clients and supervisors cannot connect the two.',
}
sections = ''.join(
    f'<h2>{i}. {html.escape(c["title"])}</h2><p class="kicker">{html.escape(c["ref"])} &middot; <a href="{html.escape(c["source"])}" rel="noopener" target="_blank">source</a></p>'
    f'<p>{html.escape(duty_text[c["id"]])}</p>' for i, c in enumerate(CHECKLIST['checks'], 1))
PAGES[p] = page(p, 'MiCA website requirements: the checklist for crypto-asset service providers (2026) | sha3.si', d, f"""
<article>
<h1>MiCA website requirements: the checklist</h1>
<p class="kicker">What the Markets in Crypto-Assets Regulation and ESMA expect to find on a CASP's website, duty by duty. Updated {TODAY}.</p>
<p>{html.escape(CHECKLIST['yardstick'])}</p>
{sections}
<h2>Check your own site</h2>
<p>The free scan runs all eight checks from Frankfurt in about a minute and fingerprints every page it reads. <a href="/#scan">Scan your website</a>.</p>
<p class="note">This page summarises the rules in plain words; it is not legal advice. Read the regulation on <a href="https://eur-lex.europa.eu/eli/reg/2023/1114/oj" rel="noopener" target="_blank">EUR-Lex</a>.</p>
{buybox()}
</article>
""", schema=[article_schema(p, 'MiCA website requirements: the checklist for CASPs', d)])


# Private report page (link with id and token from a scan).
PAGES['/r/'] = page('/r/', 'Your MiCA website report | sha3.si', 'A private sha3.si MiCA website report.', f"""
<section class="hero"><h1>MiCA website report</h1>
<p class="lead">A private link: anyone holding it can read this report, so share it only inside your firm.</p></section>
<div id="report" class="scan-result">Loading the report&hellip;</div>
{DIALOGS}
""", scripts=MICA_JS, noindex=True)

# After checkout, and the client's private account page.
PAGES['/account/'] = page('/account/', 'Your sha3.si account', 'Your sha3.si order, reports and evidence.', f"""
<section class="hero"><h1>Your sha3.si account</h1>
<p class="lead">Your order, your scans and their evidence. Questions: <a href="mailto:{CONTACT}">{CONTACT}</a>.</p></section>
<div id="account" class="scan-result">Loading&hellip;</div>
""", scripts=MICA_JS, noindex=True)

# Public verification of any record.
p = '/evidence/'
d = 'Verify a sha3.si record: its SHA3-256 fingerprint, its Merkle proof and its Bitcoin anchor through OpenTimestamps.'
PAGES[p] = page(p, 'Verify a sha3.si evidence record | sha3.si', d, f"""
<section class="hero"><h1>Verify a record</h1>
<p class="lead">Paste a record fingerprint from any sha3.si report. The Merkle proof is recomputed in your browser, and the Bitcoin proof can be checked with the open-source OpenTimestamps client.</p></section>
<section class="panel">
<form id="ev-form" class="qs-form" autocomplete="off">
<label for="ev-hash" class="hidden">Record fingerprint</label>
<input id="ev-hash" type="text" spellcheck="false" placeholder="64-character SHA3-256 record fingerprint" pattern="[0-9a-fA-F]{{64}}" required>
<button class="btn primary" type="submit">Verify</button>
</form>
</section>
<div id="evidence"></div>
<article>
<h2>How the evidence works</h2>
<ol>
<li><b>Pages.</b> The SHA3-256 of the exact bytes the server sent is stored with the URL, the HTTP status and the time. Change one byte and the fingerprint changes completely.</li>
<li><b>Records.</b> Each report is serialised as canonical JSON (keys sorted, no spaces) and fingerprinted with SHA3-256. The fingerprint covers the check results and every page fingerprint.</li>
<li><b>Days.</b> After each UTC day, all record fingerprints are sorted and combined pairwise with SHA3-256 into a Merkle tree. Its root is written into a small text file.</li>
<li><b>Bitcoin.</b> The SHA-256 of that file is submitted to the OpenTimestamps calendars, which commit it into a Bitcoin transaction. The proof file (.ots) can be checked by anyone with the <a href="https://github.com/opentimestamps/opentimestamps-client" rel="noopener" target="_blank">ots client</a>: <code>ots verify sha3si-DAY.txt.ots</code>.</li>
</ol>
<p>You can recompute any SHA3-256 fingerprint yourself with our <a href="/sha3-256/">SHA3-256 calculator</a>.</p>
</article>
""", schema=[article_schema(p, 'Verify a sha3.si evidence record', d)],
    scripts='<script src="/assets/sha3.min.js"></script>' + MICA_JS)

# Privacy notice.
p = '/privacy/'
PAGES[p] = page(p, 'Privacy notice | sha3.si', 'How sha3.si handles data: what we collect, why, where it is processed and your rights.', f"""
<article>
<h1>Privacy notice</h1>
<p class="kicker">Last updated {TODAY}.</p>
<h2>Who we are</h2>
<p>sha3.si is operated by {COMPANY}, {COMPANY_ADDRESS} (the controller). Contact for any privacy question: <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
<h2>What we collect, and why</h2>
<ul>
<li><b>Websites you ask us to scan</b>, and the public pages we fetch from them, with their fingerprints and the resulting report. Purpose: to provide the scan and keep verifiable evidence. These are business websites, not personal data, unless a page itself contains some.</li>
<li><b>Your details, if you send the form</b>: email, name, company, role and message. Purpose: to answer your request (our legitimate interest, and your consent to be contacted). We do not add you to a mailing list.</li>
<li><b>Payment details</b> are handled by Stripe. We receive your name, email, billing address and VAT number to invoice you (contract and legal obligation).</li>
<li><b>Your IP address</b> is never stored in clear. A salted hash is kept for about an hour to limit abuse of the free scan (legitimate interest).</li>
</ul>
<p>No cookies and no tracking on the MiCA service. Your browser may store your email locally, on your device only, to pre-fill forms.</p>
<h2>Who processes it for us</h2>
<ul>
<li>Vercel Inc. (application hosting; scans run in Frankfurt, Germany)</li>
<li>Turso (database)</li>
<li>Anthropic PBC (Claude reads the public text of scanned pages; no personal data is sent)</li>
<li>Stripe (payments and invoices)</li>
<li>Google (email)</li>
<li>GitHub (hosting of these static pages)</li>
</ul>
<p>Some of these providers are in the United States. Transfers rely on the EU-US Data Privacy Framework where the provider is certified, or on the European Commission's standard contractual clauses.</p>
<h2>How long we keep it</h2>
<p>Reports and evidence: as long as the service runs, because evidence is only useful if it lasts. Form messages: two years after our last exchange. Invoices: as long as tax law requires.</p>
<h2>Your rights</h2>
<p>You can ask for access to, correction or deletion of your personal data, object to its use, or ask for a copy, by writing to <a href="mailto:{CONTACT}">{CONTACT}</a>. You can also complain to your data protection authority.</p>
</article>
""")

# Terms of service.
p = '/terms/'
PAGES[p] = page(p, 'Terms of service | sha3.si', 'The terms for the sha3.si MiCA website scan, audit and monitor.', f"""
<article>
<h1>Terms of service</h1>
<p class="kicker">Last updated {TODAY}. These terms apply between {COMPANY} ("we") and the business using sha3.si ("you").</p>
<h2>1. The service</h2>
<p>sha3.si reads public websites from servers in the European Union and reports what they show against website duties in Regulation (EU) 2023/1114 (MiCA) and ESMA guidance. The free scan is automated. The audit adds a browser-rendered pass and a person's review, delivered within 48 hours of payment unless we agree otherwise. The monitor re-scans the website you name every week for as long as the subscription runs.</p>
<h2>2. Not legal advice</h2>
<p>Reports are observations of what a website showed at a given time, with references to the rules they relate to. They are not legal advice and do not say whether you comply with the law. We do not guarantee that a supervisor will reach the same view.</p>
<h2>3. Business customers only</h2>
<p>The paid services are for businesses. Prices are in euros and exclude VAT. For EU business customers, the reverse-charge mechanism applies.</p>
<h2>4. Payment, renewal and cancellation</h2>
<p>The audit is paid in advance. The monitor renews monthly or yearly until you cancel; you can cancel at any time from the billing link in your account, effective at the end of the period already paid. If we cannot deliver a paid audit, we refund it.</p>
<h2>5. Fair use</h2>
<p>Do not use the scanner to overload a website, to get around a site's access controls, or for anything unlawful. We may limit or refuse scans to protect the sites we read and the service.</p>
<h2>6. Your reports</h2>
<p>You may use your reports and evidence freely within your business, including with your supervisors, auditors and advisers. Private report links grant access to anyone who holds them; keep them inside your firm.</p>
<h2>7. Liability</h2>
<p>To the extent the law allows, our total liability under these terms is limited to the fees you paid us in the twelve months before the claim, and we are not liable for indirect or consequential loss.</p>
<h2>8. Law</h2>
<p>These terms are governed by the laws of the State of Wyoming, USA. Questions: <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
</article>
""")

# The old "buy this domain" page now points home.
EXTRA_FILES['/buy/index.html'] = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>sha3.si</title>
<meta name="robots" content="noindex"><link rel="canonical" href="{DOMAIN}/">
<meta http-equiv="refresh" content="0; url=/"></head>
<body><p><a href="/">sha3.si</a></p></body></html>
"""

# 404
NOTFOUND = page('/404.html', 'Page not found | sha3.si', 'Page not found on sha3.si.', f"""
<article><h1>Page not found</h1>
<p>That page does not exist. Try the <a href="/">MiCA website scan</a>, the <a href="/calculator/">SHA-3 calculator</a> or the <a href="/what-is-sha3/">SHA-3 guide</a>.</p>
{buybox()}</article>""")


# ---------------------------------------------------------------- write
def write(rel, text):
    full = os.path.join(SITE, rel.lstrip('/'))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)

for path, text in PAGES.items():
    write(path + 'index.html' if path.endswith('/') else path, text)
for path, text in EXTRA_FILES.items():
    write(path, text)
write('/404.html', NOTFOUND)

write('/robots.txt', f"User-agent: *\nAllow: /\nDisallow: /r/\nDisallow: /account/\n\nSitemap: {DOMAIN}/sitemap.xml\n")
write('/sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n'
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      ''.join(f'  <url><loc>{DOMAIN}{pth}</loc><lastmod>{TODAY}</lastmod></url>\n' for pth in PAGES if pth not in NOINDEX) +
      '</urlset>\n')
write('/CNAME', 'sha3.si\n')
# IndexNow key file (shared key used by APPS/indexnow-daily). Bare token, no
# newline, so autocrlf can never alter the bytes the engines compare.
INDEXNOW_KEY = 'c5ac5e393c4434c4d852f653b7258532'
write(f'/{INDEXNOW_KEY}.txt', INDEXNOW_KEY)
write('/.nojekyll', '')
write('/favicon.svg', LOGO_SVG.replace(' class="mark"', ' xmlns="http://www.w3.org/2000/svg"')
      .replace(' aria-hidden="true"', '') + '\n')
write('/site.webmanifest', json.dumps({
    'name': 'sha3.si: MiCA website evidence and SHA-3 tools', 'short_name': 'sha3.si', 'start_url': '/', 'display': 'standalone',
    'background_color': '#0b0f14', 'theme_color': '#0b0f14',
    'icons': [{'src': '/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
              {'src': '/icon-512.png', 'sizes': '512x512', 'type': 'image/png'}]}, indent=1) + '\n')
write('/llms.txt', f"""# sha3.si

> MiCA website evidence for EU crypto-asset service providers: a free scan, read from Frankfurt, of the website duties in MiCA (pricing and fees policy, climate disclosures per crypto-asset, complaints procedure, risk warnings, white-paper links, regulated versus unregulated services), with a Claude review, SHA3-256 fingerprints and daily Bitcoin anchoring through OpenTimestamps. A service of {COMPANY}. Plus free SHA-3 tools and reference: an in-browser calculator for SHA3-224, SHA3-256, SHA3-384, SHA3-512, SHAKE128, SHAKE256 and Ethereum Keccak-256, explanations, test vectors and code examples.

## MiCA service
- [Free MiCA website scan]({DOMAIN}/): checks {len(CHECKLIST['checks'])} website duties for any of the {REGISTER_COUNT} firms in ESMA's MiCA register
- [MiCA website requirements checklist]({DOMAIN}/mica-checklist/): each duty, its article, and what a page must contain
- [Verify an evidence record]({DOMAIN}/evidence/): SHA3-256 record fingerprint, Merkle proof and Bitcoin anchor
- Pricing: free scan; MiCA website audit EUR 1,490 one-off; monitor EUR 290 per month or EUR 2,900 per year with the audit included (excl. VAT)

Key facts:
- SHA-3 is standardised by NIST in FIPS 202 (August 2015) and based on Keccak (Bertoni, Daemen, Peeters, Van Assche).
- It uses the sponge construction over the Keccak-f[1600] permutation (24 rounds, 1600-bit state).
- SHA3-256 of "hello world" = {HW['sha3_256']}
- SHA3-256 of "" = {V['']['sha3_256']}
- Ethereum Keccak-256 differs from SHA3-256 only in padding (0x01 vs 0x06); Keccak-256 of "" = {V['']['keccak256']}

## Pages
- [SHA-3 calculator]({DOMAIN}/calculator/): hash text, hex or files locally in the browser
- [What is SHA-3]({DOMAIN}/what-is-sha3/): history, sponge construction, family, uses
- [SHA-3 vs SHA-256]({DOMAIN}/sha3-vs-sha256/): design, security, speed, when to use which
- [SHA-3 vs Keccak-256]({DOMAIN}/sha3-vs-keccak/): why Ethereum hashes differ from NIST SHA-3
- [Test vectors]({DOMAIN}/test-vectors/): known-answer digests for common inputs
- [Code examples]({DOMAIN}/code-examples/): Python, Node.js, browser JS, Go, Rust, Java, PHP, C#, OpenSSL
- [Is your website quantum-safe?]({DOMAIN}/quantum-safe/): free check whether a site accepts post-quantum key exchange (ML-KEM, X25519MLKEM768)
- [SHA3-256 calculator]({DOMAIN}/sha3-256/), [SHA3-512 calculator]({DOMAIN}/sha3-512/), [Keccak-256 / Ethereum calculator]({DOMAIN}/keccak-256/), [SHAKE256 calculator]({DOMAIN}/shake256/)
""")
print('built', len(PAGES) + 1, 'pages into', SITE)
