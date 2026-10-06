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
SALE_URL = 'https://forsale.dynadot.com/sha3.si'
GA_ID = 'G-MLWFJRRJ1T'  # GA4 property for sha3.si
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
    ('/', 'Calculator'),
    ('/what-is-sha3/', 'What is SHA-3'),
    ('/sha3-vs-sha256/', 'SHA-3 vs SHA-256'),
    ('/sha3-vs-keccak/', 'SHA-3 vs Keccak'),
    ('/test-vectors/', 'Test vectors'),
    ('/code-examples/', 'Code'),
    ('/buy/', 'Buy this domain'),
]

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

def page(path, title, desc, body, schema=None, scripts='', focus=''):
    nav = ''.join(f'<a href="{h}"{" class=on" if h == path else ""}>{t}</a>' for h, t in NAV)
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
<link rel="canonical" href="{DOMAIN}{path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="sha3.si">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:url" content="{DOMAIN}{path}">
<meta property="og:image" content="{DOMAIN}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="sha3.si: SHA-3 tools and reference. Domain for sale.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{DOMAIN}/og.png">
<meta name="theme-color" content="#0b0f14">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="/assets/style.css">
{ga()}{ld}
</head>
<body{body_attr}>
<div class="sale">The domain <b>sha3.si</b> is for sale. <a href="/buy/">Make an offer or buy it now &rarr;</a></div>
<header class="top"><div class="wrap">
<a class="logo" href="/">{LOGO_SVG}<b>sha3<span>.si</span></b></a>
<nav class="main">{nav}</nav>
</div></header>
<main class="wrap">
{body}
</main>
<footer><div class="wrap">
<span>sha3.si: free SHA-3 tools and reference. Calculations run in your browser; nothing you type is sent anywhere.</span>
<span>Calculators: {tools}</span>
<span><a href="/buy/">This domain is for sale</a> &middot; <a href="/llms.txt">llms.txt</a> &middot; <a href="/sitemap.xml">sitemap</a></span>
</div></footer>
{scripts}
</body>
</html>
"""

def buybox():
    return f"""<div class="buy">
<h2>Own sha3.si</h2>
<p>A short, exact-match domain for one of the world's core cryptographic standards. Ideal for a security, cryptography, blockchain or developer-tools brand.</p>
<a class="btn primary" href="{SALE_URL}" rel="nofollow">Buy now or make an offer</a>
<a class="btn" href="/buy/">Why this name</a>
</div>"""

def code(s):
    return '<pre><code>' + html.escape(s.strip('\n')) + '</code></pre>'

def org():
    return {'@type': 'Organization', 'name': 'sha3.si', 'url': DOMAIN, 'logo': DOMAIN + '/icon-512.png'}

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

# Home: the calculator
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
PAGES['/'] = page('/', 'SHA-3 Hash Calculator Online: SHA3-256, SHA3-512, SHAKE, Keccak | sha3.si', home_desc, f"""
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
     'url': DOMAIN + '/', 'applicationCategory': 'DeveloperApplication', 'operatingSystem': 'Any (web browser)',
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


# Buy page: written for the person deciding whether to buy, not for search.
p = '/buy/'
d = ('sha3.si is for sale: a short exact-match domain for SHA-3, the NIST cryptographic hash standard, with a working '
     'SHA-3 tools site. For cryptography, cybersecurity, post-quantum, blockchain and developer-tool brands.')
buy_faq = [
    ('How do I buy sha3.si?',
     'Through the Dynadot marketplace listing: buy at the listed price or send an offer. Payment is handled by Dynadot, '
     'which then moves the domain into the buyer\'s Dynadot account.'),
    ('Can I keep the domain at another registrar?',
     'Yes. After the purchase you can transfer it out of Dynadot to the registrar of your choice once any post-sale lock has passed.'),
    ('Is the website included?',
     'The current SHA-3 calculator and reference pages can be handed over with the domain, so the name keeps serving '
     'its visitors from the first day.'),
    ('Can I make an offer below the listed price?',
     'Yes. Use "Make an offer" on the Dynadot listing. Every serious offer gets a reply.'),
]
PAGES[p] = page(p, 'Buy sha3.si: premium SHA-3 domain for sale', d, f"""
<article>
<h1>sha3.si is for sale</h1>
<p class="kicker">A four-character, exact-match name for SHA-3, the NIST hash standard at the core of the new post-quantum cryptography, and a working SHA-3 tools site already built on it.</p>

<div class="buy">
<h2>Buy now or make an offer</h2>
<p>Secure checkout through Dynadot's marketplace. Buy it now, or make an offer.</p>
<a class="btn primary" href="{SALE_URL}" rel="nofollow">Go to the sha3.si listing</a>
</div>

<h2>Why this name is worth owning</h2>
<ul>
<li><b>It is the name of a standard.</b> "SHA-3" is NIST FIPS 202. Every security engineer, cryptographer and blockchain developer knows it, so the name needs no explanation and no ad budget to be understood.</li>
<li><b>Short and exact.</b> Four characters before the dot. Easy to say, type and remember, and it matches what people search for.</li>
<li><b>Rising with post-quantum migration.</b> SHA3-256, SHA3-512, SHAKE128 and SHAKE256 sit inside ML-KEM and ML-DSA, the post-quantum standards that governments and companies must now adopt. Interest in SHA-3 grows with every migration plan.</li>
<li><b>Two markets in one word.</b> NIST SHA-3 for security and compliance, and Keccak (its original form) for Ethereum and every EVM chain.</li>
<li><b>.si reads as "super intelligence".</b> The extension carries the 2026 "SI" naming for AI, which adds a second, AI-security reading to the name.</li>
<li><b>Not an empty name.</b> It comes with a live, fast, private SHA-3 calculator, four dedicated tools and reference pages, already indexed by search engines.</li>
</ul>

<h2>Who it is for</h2>
<div class="cards">
<div class="card"><b>Post-quantum and crypto vendors</b><span>A product or migration-tool brand: "post-quantum ready, built on SHA-3".</span></div>
<div class="card"><b>Security and audit firms</b><span>A memorable campaign or product domain for hashing, integrity and key-management services.</span></div>
<div class="card"><b>HSM, KMS and cloud security</b><span>A short name for an SDK, a docs portal or a developer landing page.</span></div>
<div class="card"><b>Blockchain and Web3</b><span>Wallets, node infrastructure, explorers and Keccak-heavy developer tools.</span></div>
<div class="card"><b>Developer tools and APIs</b><span>A hashing API (api.sha3.si), checksum and file-verification services, CI integrity checks.</span></div>
<div class="card"><b>AI security</b><span>Model and dataset fingerprinting, provenance and integrity: "SI" security on a SHA-3 name.</span></div>
<div class="card"><b>Education and publishing</b><span>Courses, books and reference sites on cryptography.</span></div>
<div class="card"><b>Investors</b><span>A short, standard-name ccTLD domain with an operating site and organic traffic.</span></div>
</div>

<h2>What you get</h2>
<ul>
<li>The domain <b>sha3.si</b>, moved to your account after payment.</li>
<li>The current website: a SHA-3 calculator (SHA3-224/256/384/512, SHAKE128/256, Keccak-256, text and files), dedicated tool pages, guides, test vectors and code examples, all static and fast.</li>
<li>Its search presence: pages submitted to Google and Bing, with structured data, a sitemap and an llms.txt for AI assistants.</li>
</ul>

<h2>Frequently asked</h2>
{''.join(f'<h3>{html.escape(q)}</h3><p>{html.escape(t)}</p>' for q, t in buy_faq)}

<div class="buy">
<h2>Ready to make it yours?</h2>
<p>Buy it now or send an offer. Serious offers get a reply.</p>
<a class="btn primary" href="{SALE_URL}" rel="nofollow">Buy now or make an offer</a>
</div>
</article>
""", schema=[{'@context': 'https://schema.org', '@type': 'Product', 'name': 'sha3.si domain name',
              'description': d, 'url': DOMAIN + p, 'image': DOMAIN + '/og.png', 'brand': org(),
              'offers': {'@type': 'Offer', 'url': SALE_URL, 'availability': 'https://schema.org/InStock'}},
             faq_schema(buy_faq)])


# 404
NOTFOUND = page('/404.html', 'Page not found | sha3.si', 'Page not found on sha3.si.', f"""
<article><h1>Page not found</h1>
<p>That page does not exist. Try the <a href="/">SHA-3 calculator</a> or the <a href="/what-is-sha3/">SHA-3 guide</a>.</p>
{buybox()}</article>""")


# ---------------------------------------------------------------- write
def write(rel, text):
    full = os.path.join(SITE, rel.lstrip('/'))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)

for path, text in PAGES.items():
    write(path + 'index.html' if path.endswith('/') else path, text)
write('/404.html', NOTFOUND)

write('/robots.txt', f"User-agent: *\nAllow: /\n\nSitemap: {DOMAIN}/sitemap.xml\n")
write('/sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n'
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      ''.join(f'  <url><loc>{DOMAIN}{pth}</loc><lastmod>{TODAY}</lastmod></url>\n' for pth in PAGES) +
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
    'name': 'sha3.si: SHA-3 hash tools', 'short_name': 'sha3.si', 'start_url': '/', 'display': 'standalone',
    'background_color': '#0b0f14', 'theme_color': '#0b0f14',
    'icons': [{'src': '/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
              {'src': '/icon-512.png', 'sizes': '512x512', 'type': 'image/png'}]}, indent=1) + '\n')
write('/llms.txt', f"""# sha3.si

> Free SHA-3 tools and reference: an in-browser calculator for SHA3-224, SHA3-256, SHA3-384, SHA3-512, SHAKE128, SHAKE256 and Ethereum Keccak-256, plus explanations, comparisons, test vectors and code examples. The domain sha3.si itself is for sale.

Key facts:
- SHA-3 is standardised by NIST in FIPS 202 (August 2015) and based on Keccak (Bertoni, Daemen, Peeters, Van Assche).
- It uses the sponge construction over the Keccak-f[1600] permutation (24 rounds, 1600-bit state).
- SHA3-256 of "hello world" = {HW['sha3_256']}
- SHA3-256 of "" = {V['']['sha3_256']}
- Ethereum Keccak-256 differs from SHA3-256 only in padding (0x01 vs 0x06); Keccak-256 of "" = {V['']['keccak256']}

## Pages
- [SHA-3 calculator]({DOMAIN}/): hash text, hex or files locally in the browser
- [What is SHA-3]({DOMAIN}/what-is-sha3/): history, sponge construction, family, uses
- [SHA-3 vs SHA-256]({DOMAIN}/sha3-vs-sha256/): design, security, speed, when to use which
- [SHA-3 vs Keccak-256]({DOMAIN}/sha3-vs-keccak/): why Ethereum hashes differ from NIST SHA-3
- [Test vectors]({DOMAIN}/test-vectors/): known-answer digests for common inputs
- [Code examples]({DOMAIN}/code-examples/): Python, Node.js, browser JS, Go, Rust, Java, PHP, C#, OpenSSL
- [SHA3-256 calculator]({DOMAIN}/sha3-256/), [SHA3-512 calculator]({DOMAIN}/sha3-512/), [Keccak-256 / Ethereum calculator]({DOMAIN}/keccak-256/), [SHAKE256 calculator]({DOMAIN}/shake256/)

## Domain
- [Buy sha3.si]({DOMAIN}/buy/): the domain is available; listing at {SALE_URL}
""")
print('built', len(PAGES) + 1, 'pages into', SITE)
