// The MiCA website scan: reads a crypto firm's site the way a supervisor's
// staff would (homepage, then one more click), and records evidence for each
// check in data/checklist.json. Rules only; the Claude review runs after it on
// the pages this finds (lib/review.js).
import { safeFetch, decompress } from "./net.js";
import { decodeBody, textOf, linksOf, titleOf, langOf, snippets, MAX_PARSE } from "./html.js";
import { sha3 } from "./evidence.js";
import { firmByHost, firmByLei, registerSiteOk, siteKey, publicFirm, isSharedSite, CHECKLIST } from "./register.js";

// Link text or URL that points at each disclosure, in EN NL DE FR IT ES PT.
export const KIND_RX = {
  fees: /\bfees?\b|pricing|price.?list|tarie|tarif|kosten|commission|\bcosts?\b|charges|geb(ü|ue)hr|preise|frais|commissioni|comisi|taxas|precios/i,
  sustainability: /sustainab|duurzaam|\besg\b|climat|environment|adverse.?impact|mica.?disclos|consensus|nachhaltig|umwelt|durabil|sostenib|sustentab/i,
  complaints: /complain|klacht|reclam|grievance|beschwerde|plainte|reclami|queixa/i,
  whitepapers: /white.?paper|whitepaper|livre.?blanc|libro.?bianco|wei(ß|ss)buch|witboek/i,
  risk: /\brisks?\b|risico|riesgo|rischi|risque|risiko/i,
};
// Words that make a link look like a disclosure page rather than a sales line.
const DISCLOSURE_WORDS = /policy|grid|schedule|overview|disclos|document|legal|procedure|terms|informat|beleid|politi|richtlin|bericht|report|indicator|warning|notice/i;

// Best link for a disclosure: path match beats text match, short labels beat
// marketing sentences ("Transfer your cryptos at no cost" is not a fee page).
function rankLinks(links, rx) {
  const score = (l) => {
    let path = "";
    try {
      path = new URL(l.abs).pathname + new URL(l.abs).hash;
    } catch {
      path = l.href;
    }
    const words = l.text.split(/\s+/).filter(Boolean).length;
    return (rx.test(path) ? 3 : 0) + (rx.test(l.text) ? 1 : 0) + (DISCLOSURE_WORDS.test(path + " " + l.text) ? 1 : 0)
      + (words && words <= 4 ? 1 : 0) - (words > 6 ? 3 : 0);
  };
  return links.map((l) => [score(l), l]).sort((a, b) => b[0] - a[0]).map(([, l]) => l);
}
const HUB_RX = /legal|disclos|mica|document|policies|policy|regulat|compliance|terms|juridi|voorwaarden|transparen|rechtlich|mentions|aviso|impressum|imprint|about/i;
const HUB_FIRST_RX = /legal.?doc|\/legal\/?$|disclos|mica|regulat|documents|juridi/i;
const HUB_LAST_RX = /privacy|cookie|privacidad|datenschutz|career|jobs|press/i;
const BLOG_RX = /\/(blog|news|nieuws|noticias|actualites|notizie|academy|learn|aprende|aprender|leren|lernen|apprendre|impara|research|insights|newsroom|articles?|case-studies|knowledge-base|guides?|press|magazine|stories|category|tag|author|glossary|faq)\//i;
const LICENCE_RX = /\bMiCA\b|MiCAR|crypto.?asset service provider|\bCASP\b|prestataire de services sur crypto|cryptoactivos|cripto-attivit|kryptowerte|cryptobedrijf|authori[sz]ed|licensed|vergunning|regulated by|registered with|autoris|autorizad|autorizzat|zugelassen|lizenz/i;
const RISK_RX = /high.?risk|risk of los|lose (all|some|the|part)|capital (is )?at risk|volatil|risico|verlies|riesgo|perder|rischio|perdita|risque|perte|risiko|verlust|not (be )?suitable/i;
const YIELD_RX = /\bAPY\b|\bAPR\b|\bTAE\b|staking|\bearn\b|rewards?|rendement|rente\b|yield|interest|rendimiento|rentabilidad|rendita|zinsen/i;
const UNREG_RX = /not (covered|regulated)|outside (the )?(scope of )?MiCA|non.?regulated|unregulated|no (est|está) regulad|niet gereguleerd|nicht reguliert|non regolament|non réglementé/i;

const APP_SHELL_TEXT = 1500;
const APP_SHELL_LINKS = 10;

// Where the requests really leave from. Evidence must never claim a place it
// was not read from: anything but Vercel fra1 says so plainly.
export function readFrom() {
  const region = process.env.VERCEL_REGION || "";
  if (region === "fra1") return { provider: "Vercel", region, place: "Frankfurt am Main, Germany", eu: true };
  return { provider: region ? "Vercel" : "local", region: region || "local", place: region ? `Vercel region ${region} (outside Frankfurt)` : "a test machine outside the EU", eu: false };
}

export function normalizeInput(input) {
  let s = String(input || "").trim();
  if (!s) throw Object.assign(new Error("enter a website or pick a firm"), { code: "EINPUT" });
  if (!/^https?:\/\//i.test(s)) s = "https://" + s.replace(/^\/+/, "");
  const url = new URL(s);
  url.hash = "";
  return url;
}

function sameSite(a, b) {
  try {
    return siteKey(new URL(a).hostname) === siteKey(new URL(b).hostname);
  } catch {
    return false;
  }
}

function legalCore(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\b(b\.?v\.?|n\.?v\.?|ltd\.?|limited|gmbh|ag|s\.?a\.?s?\.?|s\.?l\.?|s\.?p\.?a\.?|s\.?r\.?l\.?|plc|inc\.?|llc|ug|kg|oy|ab|as|a\/s|sp\. z o\.o\.|europe|eu)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// A firm id (LEI) only names the report when the website is one the register
// lists for that firm; otherwise anyone could title their own pages with a
// registered firm's name.
export function firmFor(url, lei) {
  const byLei = lei ? firmByLei(lei) : null;
  if (byLei && byLei.w.some((w) => !isSharedSite(w) && sameSite(w, url.href))) return byLei;
  return firmByHost(url.hostname);
}

export async function scan({ input, lei }, emit = () => {}) {
  const started = Date.now();
  const leiFirm = lei ? firmByLei(lei) : null;
  const url = normalizeInput(input || (leiFirm && leiFirm.w[0]));
  const firm = firmFor(url, lei);

  const evidence = [];
  const cache = new Map();
  const limits = [];
  // Past the first point, optional reads (sitemaps, extra legal pages) are
  // skipped; past the second, every read is, so no site can hold a scan long.
  const softDeadline = started + 60000;
  const hardDeadline = started + 100000;

  async function get(target, role, { quiet = false, maxBytes, optional = false } = {}) {
    if (cache.has(target)) return cache.get(target);
    if ((optional && Date.now() > softDeadline) || Date.now() > hardDeadline) {
      return { role, url: target, status: 0, error: "ESKIPPED", message: "skipped: scan time budget used", html: "" };
    }
    const job = (async () => {
      const at = new Date().toISOString();
      try {
        const offSite = !sameSite(target, url.href);
        const r = await safeFetch(target, { maxBytes: offSite ? Math.min(maxBytes || 3_000_000, 1_000_000) : maxBytes || 3_000_000, timeoutMs: 12000 });
        let body = r.body;
        if (body[0] === 0x1f && body[1] === 0x8b) {
          try {
            body = decompress(body, "gzip");
          } catch (e) {
            if (e.code === "E2BIG") throw e; // a compressed bomb served as a file
          }
        }
        const type = String(r.headers["content-type"] || "");
        const isHtml = /html|xml|text\/plain/i.test(type) || /^\s*</.test(body.subarray(0, 64).toString("latin1"));
        const html = isHtml ? decodeBody(body, type) : "";
        const page = {
          role, url: target, final_url: r.url, status: r.status, fetched_at: at, ms: r.ms,
          bytes: body.length, content_type: type.split(";")[0], sha3_256: sha3(body), truncated: r.truncated,
          html, body,
        };
        evidence.push({
          role, url: target, final_url: r.url, status: r.status, fetched_at: at,
          bytes: body.length, content_type: page.content_type, sha3_256: page.sha3_256,
        });
        if (!quiet) emit("fetch", { role, url: r.url, status: r.status, bytes: body.length, ms: r.ms, sha3_256: page.sha3_256 });
        return page;
      } catch (e) {
        if (!quiet) emit("fetch", { role, url: target, error: e.code || "ERROR", message: e.message });
        return { role, url: target, status: 0, error: e.code || "ERROR", message: e.message, html: "", fetched_at: at };
      }
    })();
    cache.set(target, job);
    return job;
  }

  const from = readFrom();
  emit("step", { msg: `Reading ${url.hostname} from ${from.place}` });
  const home = await get(url.href, "homepage");
  const homeText = home.html ? textOf(home.html) : "";
  const homeLinks = home.html ? linksOf(home.html, home.final_url) : [];
  const report = {
    v: 1,
    scanned_from: from,
    target: { input: String(input || ""), url: url.href, final_url: home.final_url || url.href, host: url.hostname },
    page: { title: home.html ? titleOf(home.html) : "", lang: home.html ? langOf(home.html) : "", text_chars: homeText.length, links: homeLinks.length },
    firm: publicFirm(firm),
    checks: [],
    signals: {},
    evidence,
    limits,
  };

  if (!home.status || home.status >= 400) {
    const why = home.status ? `answered HTTP ${home.status}` : `could not be reached (${home.message || home.error})`;
    limits.push(`The homepage ${why} when read from ${from.place}, so nothing else could be checked.`);
    report.unreadable = true;
    report.duration_ms = Date.now() - started;
    return { report, material: null };
  }
  if (home.html.length > MAX_PARSE) {
    limits.push(`The homepage is ${Math.round(home.html.length / 1000)} KB of HTML; the first ${MAX_PARSE / 1000} KB were analysed. The fingerprint covers the whole page.`);
  }
  if (homeText.length < APP_SHELL_TEXT || homeLinks.length < APP_SHELL_LINKS) {
    limits.push(`The homepage serves little HTML (${homeText.length} characters, ${homeLinks.length} links): it is built by JavaScript in the browser, so links in its menus may be missed. A browser-rendered pass is part of the paid audit.`);
  }

  emit("step", { msg: `Homepage read: ${homeLinks.length} links, ${homeText.length.toLocaleString("en")} characters of text` });

  // Sitemap: robots.txt first, then the usual locations.
  const origin = new URL(home.final_url).origin;
  const sitemapUrls = [];
  const robots = await get(origin + "/robots.txt", "robots", { quiet: true, maxBytes: 200_000, optional: true });
  // Line by line: a multiline regex over robots.txt went quadratic on blank lines.
  // Only sitemaps on the scanned site itself are read, never another site's.
  const onSite = (u) => {
    try {
      return /^https?:$/.test(new URL(u).protocol) && sameSite(u, home.final_url);
    } catch {
      return false;
    }
  };
  const declared = robots.status === 200
    ? robots.html.slice(0, 200_000).split(/\r?\n/).map((l) => /^\s{0,20}sitemap:\s{0,20}(\S{1,2000})/i.exec(l)).filter(Boolean).map((m) => m[1]).filter(onSite)
    : [];
  const locsOf = (xml) => [...xml.matchAll(/<loc>\s{0,50}([^<\s]{1,2000})\s{0,50}<\/loc>/gi)].map((m) => m[1]);
  // A sitemap's body is dropped as soon as its <loc> entries are read, so a
  // site serving many large sitemaps cannot fill the function's memory.
  const release = (p) => {
    p.html = "";
    p.body = null;
  };
  for (const sm of [...new Set([...declared.slice(0, 3), origin + "/sitemap.xml", origin + "/sitemap_index.xml"])]) {
    const page = await get(sm, "sitemap", { quiet: true, maxBytes: 2_000_000, optional: true });
    if (page.status !== 200 || !/<loc>/i.test(page.html)) continue;
    const locs = locsOf(page.html).filter(onSite);
    const isIndex = /<sitemapindex/i.test(page.html);
    release(page);
    if (isIndex) {
      // Legal and page sitemaps first; post, product and image sitemaps are rarely where disclosures live.
      const ordered = locs.sort((a, b) => (/page|legal|static|main|general/i.test(b) ? 1 : 0) - (/page|legal|static|main|general/i.test(a) ? 1 : 0));
      await pool(ordered.slice(0, 6), 3, async (s) => {
        const sub = await get(s, "sitemap", { quiet: true, maxBytes: 2_000_000, optional: true });
        sitemapUrls.push(...locsOf(sub.html || "").filter(onSite));
        release(sub);
      });
    } else {
      sitemapUrls.push(...locs);
    }
    if (sitemapUrls.length) break;
  }
  sitemapUrls.splice(20000);
  emit("step", { msg: sitemapUrls.length ? `Sitemap read: ${sitemapUrls.length.toLocaleString("en")} pages listed` : "No sitemap found" });

  // Legal and disclosure hub pages one click from the homepage.
  const candidates = homeLinks.filter((l) => l.abs && /^https?:/.test(l.abs) && sameSite(l.abs, home.final_url)
    && !l.abs.toLowerCase().endsWith(".pdf") && HUB_RX.test(l.href + " " + l.text) && !BLOG_RX.test(l.abs));
  const rank = (l) => (HUB_FIRST_RX.test(l.abs + " " + l.text) ? 0 : HUB_LAST_RX.test(l.abs + " " + l.text) ? 2 : 1);
  const hubUrls = [...new Set(candidates.sort((a, b) => rank(a) - rank(b)).map((l) => l.abs))].slice(0, 6);
  if (hubUrls.length) emit("step", { msg: `Opening ${hubUrls.length} legal and disclosure pages linked from the homepage` });
  const hubs = await pool(hubUrls, 4, (h) => get(h, "legal-page", { optional: true }));
  // Each hub page's links are parsed once, not once per disclosure looked for.
  const hubLinks = hubs.map((h) => (h.html ? linksOf(h.html, h.final_url) : []));

  const servicesNeedingPapers = new Set(["b", "c", "d", "h", "i"]);
  const papersApply = firm ? [...firm.sv].some((s) => servicesNeedingPapers.has(s)) : null;

  const material = { homepage: { url: home.final_url, text: homeText, lang: report.page.lang } };

  async function locate(kind) {
    const rx = KIND_RX[kind];
    const usable = (l) => l.abs && /^https?:/.test(l.abs) && !["", "#", "/"].includes(l.href.trim())
      && !/^(javascript|mailto|tel):/i.test(l.href) && !BLOG_RX.test(l.abs);
    const direct = rankLinks(homeLinks.filter((l) => rx.test(l.href + " " + l.text)), rx);
    const directUsable = direct.filter(usable);
    if (direct.length && !directUsable.length) {
      return { state: "broken", detail: `The homepage link "${direct[0].text || direct[0].href}" points to "${direct[0].href}", not to a page.`, link: direct[0] };
    }
    if (directUsable.length) {
      const target = directUsable[0];
      const page = await get(target.abs, kind);
      if (page.status === 200) return { state: "ok", detail: `Linked from the homepage as "${target.text || target.href}".`, link: target, page };
      if (page.status === 401 || page.status === 403 || page.error === "EBLOCKED") {
        return { state: "unverified", detail: `Linked from the homepage, but the page refused our request (${page.status || page.error}).`, link: target };
      }
      return { state: "broken", detail: `The homepage link "${target.text || target.href}" answers ${page.status ? "HTTP " + page.status : page.message}.`, link: target, page };
    }
    for (const [i, hub] of hubs.entries()) {
      if (!hub.html) continue;
      const found = rankLinks(hubLinks[i].filter((l) => usable(l) && rx.test(l.href + " " + l.text)), rx)[0];
      if (found) {
        const page = await get(found.abs, kind);
        const ok = page.status === 200;
        return {
          state: ok ? "two_clicks" : "broken",
          detail: ok ? `Two clicks deep: homepage, then "${hub.final_url}", then "${found.text || found.href}".`
            : `Linked from "${hub.final_url}", but the page answers ${page.status ? "HTTP " + page.status : page.message}.`,
          link: found, via: hub.final_url, page,
        };
      }
    }
    const inSitemap = rankLinks(sitemapUrls.filter((u) => {
      try {
        return rx.test(new URL(u).pathname) && !BLOG_RX.test(u);
      } catch {
        return false;
      }
    }).map((u) => ({ abs: u, href: u, text: "" })), rx).map((l) => l.abs);
    if (inSitemap.length) {
      const page = await get(inSitemap[0], kind);
      if (page.status === 200) {
        return { state: "not_linked", detail: `The page exists (${inSitemap[0]}) but we could not reach it within two clicks of the homepage.`, page, sitemap: inSitemap.slice(0, 3) };
      }
    }
    return {
      state: "missing",
      detail: sitemapUrls.length ? "Not found on the homepage, on the legal pages it links to, or in the sitemap."
        : "Not found on the homepage or on the legal pages it links to, and the site publishes no sitemap to check.",
    };
  }

  const LABEL = {
    ok: "Found, linked from the homepage", two_clicks: "Found, two clicks from the homepage",
    not_linked: "Exists, but not within two clicks", missing: "Not found", broken: "Broken link",
    unverified: "Could not verify", na: "Not applicable", review: "Needs a human look",
  };
  const def = Object.fromEntries(CHECKLIST.checks.map((c) => [c.id, c]));
  function addCheck(id, result) {
    const c = def[id];
    const entry = {
      id, title: c.title, ref: c.ref, state: result.state, label: LABEL[result.state] || result.state,
      detail: result.detail || "",
    };
    if (result.link) entry.link = { text: result.link.text, href: result.link.abs || result.link.href };
    if (result.via) entry.via = result.via;
    if (result.page && result.page.final_url) entry.page = { url: result.page.final_url, sha3_256: result.page.sha3_256, status: result.page.status };
    if (result.sitemap) entry.sitemap = result.sitemap;
    if (result.snippet) entry.snippet = result.snippet;
    report.checks.push(entry);
    emit("check", entry);
    return entry;
  }

  // 1. Authorisation statement on the homepage.
  const licence = snippets(homeText, LICENCE_RX, 2);
  addCheck("licence", licence.length
    ? { state: "ok", detail: "The homepage mentions an authorisation or licence.", snippet: licence[0] }
    : { state: "missing", detail: "No authorisation wording found in the homepage text." });

  // 2-5. Disclosures that must be reachable from the homepage.
  for (const kind of ["fees", "sustainability", "complaints"]) {
    emit("step", { msg: `Looking for: ${def[kind].title.toLowerCase()}` });
    const r = await locate(kind);
    addCheck(kind, r);
    if (r.page && r.page.html) material[kind] = { url: r.page.final_url, text: textOf(r.page.html) };
  }
  if (papersApply === false) {
    addCheck("whitepapers", { state: "na", detail: "The firm's registered services do not include a trading platform, exchange, advice or portfolio management." });
  } else {
    let r = await locate("whitepapers");
    if (r.state === "missing") {
      // White papers usually sit on each coin's page: open one (Bitcoin first).
      const assetLink = homeLinks.find((l) => l.abs && sameSite(l.abs, home.final_url) && !BLOG_RX.test(l.abs)
        && /bitcoin|\/btc\b|\/eth|ethereum/i.test(l.abs + " " + l.text));
      if (assetLink) {
        const asset = await get(assetLink.abs, "asset-page");
        const paper = asset.html && linksOf(asset.html, asset.final_url).find((l) => l.abs && KIND_RX.whitepapers.test(l.href + " " + l.text));
        if (paper) r = { state: "two_clicks", detail: `Found on the asset page "${asset.final_url}" as "${paper.text || paper.href}".`, link: paper, via: asset.final_url };
        else r.detail += ` A sample asset page (${asset.final_url}) has no white-paper link either.`;
      }
    }
    if (papersApply === null && r.state === "missing") {
      r.state = "review";
      r.detail = "No white-paper links found. Whether they are required depends on the services the firm is authorised for.";
    }
    addCheck("whitepapers", r);
  }

  // 6. Risk warning, and where it sits.
  const risk = snippets(homeText, RISK_RX, 2);
  const yieldHits = snippets(homeText, YIELD_RX, 2);
  const firstRisk = homeText.search(RISK_RX);
  const footerOnly = firstRisk >= 0 && firstRisk > homeText.length * 0.8;
  report.signals = { yield_marketing: yieldHits, risk_wording: risk, unregulated_disclaimer: snippets(homeText, UNREG_RX, 2) };
  if (!risk.length) {
    const r = await locate("risk");
    if (r.state === "ok" || r.state === "two_clicks") {
      r.detail = `No risk wording on the homepage itself, but a risk warning page is linked: ${r.detail}`;
      if (yieldHits.length) r.state = "review";
    }
    addCheck("risk", r.state === "missing" ? { state: "missing", detail: "No risk wording on the homepage and no risk warning page linked from it." } : r);
  } else if (footerOnly && yieldHits.length) {
    addCheck("risk", { state: "review", detail: "Risk wording appears only in the last part of the page (the footer), while the page promotes returns or rewards higher up.", snippet: risk[0] });
  } else addCheck("risk", { state: "ok", detail: "The homepage carries risk wording.", snippet: risk[0] });

  // 7. Regulated vs unregulated: rules can only flag; the review decides.
  if (yieldHits.length && !report.signals.unregulated_disclaimer.length) {
    addCheck("unregulated", { state: "review", detail: "The homepage promotes yield, staking or rewards and says nowhere that any of it falls outside MiCA.", snippet: yieldHits[0] });
  } else if (yieldHits.length) {
    addCheck("unregulated", { state: "ok", detail: "Yield or rewards are promoted, and the page says some services fall outside MiCA.", snippet: report.signals.unregulated_disclaimer[0] });
  } else {
    addCheck("unregulated", { state: "ok", detail: "No yield, staking or reward promotion on the homepage." });
  }

  // 8. Register entry versus the real site.
  if (!firm) {
    addCheck("register", { state: "review", detail: "This website is not listed for any firm in ESMA's interim MiCA register. If the firm is authorised, its register entry may show another address." });
  } else if (!registerSiteOk(firm)) {
    addCheck("register", { state: "missing", detail: `The register lists "${firm.w.join(", ")}" as this firm's website, which is not a site the firm runs.` });
  } else {
    const matches = firm.w.some((w) => sameSite(w, home.final_url));
    const core = legalCore(firm.n);
    const pagesText = [homeText, ...hubs.map((h) => (h.html ? textOf(h.html) : ""))].join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ");
    const named = core && pagesText.includes(core);
    if (!matches) addCheck("register", { state: "review", detail: `The register lists ${firm.w.join(", ")}, but the scan landed on ${new URL(home.final_url).hostname}.` });
    else if (!named) addCheck("register", { state: "review", detail: `The site matches the register, but we did not find the legal name "${firm.n}" on the homepage or its legal pages.` });
    else addCheck("register", { state: "ok", detail: `The register's website matches, and the site names "${firm.n}".` });
  }

  const counted = report.checks.filter((c) => !["na", "unverified"].includes(c.state));
  report.score = {
    passed: counted.filter((c) => c.state === "ok" || c.state === "two_clicks").length,
    gaps: counted.filter((c) => ["missing", "broken", "not_linked"].includes(c.state)).length,
    review: counted.filter((c) => c.state === "review").length,
    applicable: counted.length,
  };
  report.sitemap_pages = sitemapUrls.length;
  report.duration_ms = Date.now() - started;
  return { report, material, pages: [...(await Promise.all(cache.values()))] };
}
