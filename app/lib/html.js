// Reading server HTML without a browser: decode bytes, pull visible text and
// links, honour <base href>. Approximate by design; the scanner reports when
// a page is too app-rendered for this to see.

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", laquo: "«", raquo: "»", euro: "€", copy: "©", reg: "®",
  trade: "™", middot: "·", bull: "•", deg: "°", times: "×", eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  aacute: "á", agrave: "à", acirc: "â", auml: "ä", aring: "å", atilde: "ã", iacute: "í", igrave: "ì",
  iuml: "ï", oacute: "ó", ograve: "ò", ocirc: "ô", ouml: "ö", otilde: "õ", oslash: "ø", uacute: "ú",
  ugrave: "ù", ucirc: "û", uuml: "ü", ntilde: "ñ", ccedil: "ç", szlig: "ß", Eacute: "É", Aacute: "Á",
  Oacute: "Ó", Uuml: "Ü", Ouml: "Ö", Auml: "Ä", Ntilde: "Ñ", Ccedil: "Ç", iexcl: "¡", iquest: "¿",
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]{1,8}|#\d{1,8}|[a-z]{1,12});/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

export function decodeBody(buf, contentType = "") {
  let label = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!label) {
    const head = buf.subarray(0, 4096).toString("latin1");
    label = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(label || "utf-8", { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }
}

// Pages are parsed up to this size; the fingerprint always covers the full body.
export const MAX_PARSE = 600_000;

// Remove comments and script/style-like blocks in one linear pass. Lazy regexes
// such as /<!--[\s\S]*?-->/ go quadratic on hostile input (thousands of "<!--"
// with no end), which let a single page hold the function for minutes.
const BLOCK_OPEN = /<!--|<(script|style|noscript|svg|template|iframe)\b/gi;
export function stripBlocks(html) {
  const lower = html.toLowerCase();
  let out = "";
  let pos = 0;
  BLOCK_OPEN.lastIndex = 0;
  let m;
  while ((m = BLOCK_OPEN.exec(html))) {
    out += html.slice(pos, m.index) + " ";
    const close = m[0] === "<!--" ? "-->" : `</${m[1].toLowerCase()}`;
    const end = lower.indexOf(close, m.index + m[0].length);
    if (end < 0) {
      pos = html.length;
      break;
    }
    const gt = close === "-->" ? end + 3 : lower.indexOf(">", end) + 1 || end + close.length;
    pos = gt;
    BLOCK_OPEN.lastIndex = gt;
  }
  return out + html.slice(pos);
}

export function textOf(html) {
  const stripped = stripBlocks(html.slice(0, MAX_PARSE))
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article|footer|header|nav)\b[^<>]{0,2000}>/gi, " \n")
    .replace(/<[^<>]{0,5000}>/g, " ");
  return decodeEntities(stripped).replace(/[ \t\r\f\v\xa0]+/g, " ").replace(/ ?\n[\n ]*/g, "\n").trim();
}

export function baseOf(html, pageUrl) {
  const m = /<base\b[^>]{0,500}href=["']([^"']{1,2000})["']/i.exec(html.slice(0, 100000));
  try {
    return m ? new URL(decodeEntities(m[1]), pageUrl).href : pageUrl;
  } catch {
    return pageUrl;
  }
}

// Each <a ...> opening tag, then its text up to the next "</a" found with
// indexOf (linear), at most 2,000 characters on.
export function linksOf(htmlIn, pageUrl) {
  const html = stripBlocks(htmlIn.slice(0, MAX_PARSE));
  const lower = html.toLowerCase();
  const base = baseOf(html, pageUrl);
  const out = [];
  const re = /<a\b([^<>]{0,2000})>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 3000) {
    const href = /\bhref\s*=\s*(?:"([^"]{0,2000})"|'([^']{0,2000})'|([^\s>]{1,2000}))/i.exec(m[1]);
    if (!href) continue;
    const from = m.index + m[0].length;
    const close = lower.indexOf("</a", from);
    const inner = html.slice(from, close >= 0 && close - from <= 2000 ? close : from + 300);
    const raw = decodeEntities((href[1] ?? href[2] ?? href[3] ?? "").trim());
    const label = decodeEntities(inner.replace(/<[^<>]{0,2000}>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 90);
    const aria = /\baria-label\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1] || "";
    let abs = null;
    try {
      abs = new URL(raw, base).href;
    } catch {
      abs = null;
    }
    out.push({ href: raw, abs, text: label || decodeEntities(aria).slice(0, 90) });
  }
  return out;
}

export function titleOf(html) {
  return decodeEntities(/<title[^>]{0,500}>([\s\S]{0,2000}?)<\/title>/i.exec(html.slice(0, 100000))?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

export function langOf(html) {
  return /<html\b[^>]{0,2000}\blang=["']?([\w-]{1,20})/i.exec(html.slice(0, 20000))?.[1] || "";
}

// Up to `max` short excerpts around matches of `re` in `text`.
export function snippets(text, re, max = 3, width = 220) {
  const flat = text.replace(/\s+/g, " ");
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const out = [];
  let m;
  while ((m = g.exec(flat)) && out.length < max) {
    const start = Math.max(0, m.index - 80);
    out.push(flat.slice(start, start + width).trim());
    if (m[0].length === 0) g.lastIndex++;
  }
  return out;
}
