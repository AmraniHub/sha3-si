// Telegram: owner alerts and the customer bot, as Bot API rich messages
// (sendRichMessage, Bot API 10.1-10.3) with a plain-text fallback.
//
// Field names follow https://core.telegram.org/bots/api as read on 2026-11-12:
// InputRichMessage.blocks, InputRichBlockSectionHeading (type "heading", size),
// InputRichBlockParagraph, InputRichBlockTable (cells of RichBlockTableCell,
// is_bordered / is_striped / is_compact), InputRichBlockDocument (type
// "document", document = InputMediaDocument, caption = RichBlockCaption),
// InputRichBlockButtons (1-8 RichMessageButton), InputRichBlockFooter.
//
// Tokens:
//   TELEGRAM_CUSTOMER_BOT_TOKEN  the public sha3.si bot (webhook /api/telegram)
//   TELEGRAM_BOT_TOKEN           optional, the bot that sends owner alerts;
//                                falls back to the customer bot
//   TELEGRAM_CHAT_ID             the owner's chat with the alert bot
// The customer bot has its own variable on purpose: setting a webhook on a
// bot that is read with getUpdates elsewhere (the laptop bot) silences it.
import { createHmac, timingSafeEqual } from "node:crypto";
import { canonical } from "./evidence.js";
import { PLANS, SITE } from "./stripe.js";

const API = "https://api.telegram.org";

export const customerToken = () => process.env.TELEGRAM_CUSTOMER_BOT_TOKEN || "";
export const alertToken = () => process.env.TELEGRAM_BOT_TOKEN || customerToken();
export const ownerChat = () => process.env.TELEGRAM_CHAT_ID || "";
export const alertsConfigured = () => Boolean(alertToken() && ownerChat());

// The webhook secret is derived from the bot token, so there is no extra
// variable to keep in step; Telegram sends it back in every webhook request.
export function webhookSecret(tokenValue = customerToken()) {
  return tokenValue ? createHmac("sha256", tokenValue).update("sha3.si telegram webhook v1").digest("hex") : "";
}

export function secretMatches(header, tokenValue = customerToken()) {
  const want = webhookSecret(tokenValue);
  const got = String(header || "");
  return Boolean(want) && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// One Bot API call. JSON when there is no file; multipart/form-data (objects as
// JSON strings, files under their attach:// names) when there is.
export async function call(tokenValue, method, params = {}, files = []) {
  let init;
  if (files.length) {
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    for (const f of files) form.append(f.name, new Blob([f.bytes], { type: f.type || "application/octet-stream" }), f.filename);
    init = { method: "POST", body: form };
  } else {
    init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) };
  }
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${API}/bot${tokenValue}/${method}`, { ...init, signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
      if (r.status === 429 || r.status >= 500) {
        last = j;
        await new Promise((res) => setTimeout(res, Math.min(5, (j.parameters && j.parameters.retry_after) || 1) * 1000));
        continue;
      }
      return j;
    } catch (e) {
      last = { ok: false, description: e.message };
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  }
  return last || { ok: false, description: "no answer" };
}

/* ------------------------------------------------------------- builders */

const ICON = { ok: "✅", two_clicks: "✅", missing: "❌", broken: "❌", not_linked: "❌", review: "⚠️", na: "➖", unverified: "❔" };

export function eur(cents) {
  const v = Math.round(cents / 100);
  return "EUR " + v.toLocaleString("en-US");
}

export const buyLabel = () => `Buy the full audit (${eur(PLANS.audit.amount)})`;

const hostOf = (report) => String((report.target && report.target.host) || "").replace(/^www\./, "");

export function links(report, { id, token } = {}) {
  const host = hostOf(report);
  const reportUrl = id && token ? `${SITE}/r/?id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}` : null;
  return {
    report: reportUrl,
    buy: reportUrl ? reportUrl + "&buy=audit" : `${SITE}/?host=${encodeURIComponent(host)}#pricing`,
    evidence: id && token ? `${SITE}/evidence/?h=${report.record_hash}` : null,
  };
}

// The sealed record as a file whose SHA3-256 is the record fingerprint:
// canonical JSON (sorted keys, no whitespace) of everything but record_hash.
export function recordFile(report) {
  const { record_hash, ...rest } = report;
  return {
    name: "record",
    filename: `sha3si-${hostOf(report) || "scan"}-${report.id || "record"}.json`,
    type: "application/json",
    bytes: Buffer.from(canonical(rest), "utf8"),
  };
}

function pageOf(c) {
  const u = (c.page && c.page.url) || (c.link && c.link.href) || null;
  if (!u) return null;
  let short = u;
  try {
    const p = new URL(u);
    short = (p.pathname + p.search).replace(/\/$/, "") || "/";
  } catch {}
  return { url: u, short: short.length > 32 ? short.slice(0, 31) + "…" : short };
}

const cell = (text, extra = {}) => ({ text, align: "left", valign: "top", ...extra });

function summaryLine(report) {
  const s = report.score;
  if (report.unreadable || !s) return "The site could not be read, so no checks ran.";
  return `${s.passed} of ${s.applicable} checks passed · ${s.gaps} gap${s.gaps === 1 ? "" : "s"} · ${s.review} to review`;
}

function firmLine(report) {
  const f = report.firm;
  const from = report.scanned_from && report.scanned_from.place ? ` Read from ${report.scanned_from.place}.` : "";
  return (f ? `${f.name} (LEI ${f.lei}).` : "Not listed for any firm in ESMA's interim MiCA register.") + from;
}

function aiLine(report) {
  const ai = report.ai;
  if (!ai) return null;
  if (ai.findings) return `Claude's review: ${ai.findings.length} point${ai.findings.length === 1 ? "" : "s"} on the disclosure texts, listed in the full report.`;
  if (ai.skipped) return `Claude's review: not run (${ai.skipped}).`;
  return null;
}

// audience "customer": buy button + report; "owner": report + evidence.
export function scanMessage(report, { id, token, audience = "customer", source = "" } = {}) {
  const host = hostOf(report);
  const l = links(report, { id, token });
  const at = report.scanned_at || new Date().toISOString();
  const unix = Math.floor(Date.parse(at) / 1000);
  const checks = report.checks || [];

  const buttons = [];
  if (audience === "customer") {
    buttons.push({ text: buyLabel(), url: l.buy, style: "primary" });
    if (l.report) buttons.push({ text: "Open the full report", url: l.report });
  } else {
    if (l.report) buttons.push({ text: "Open the report", url: l.report, style: "primary" });
    if (l.evidence) buttons.push({ text: "Evidence record", url: l.evidence });
  }

  const heading = audience === "owner" ? `New scan: ${host}` : `MiCA website scan: ${host}`;
  const blocks = [{ type: "heading", size: 2, text: heading }];
  if (audience === "owner" && source) blocks.push({ type: "paragraph", text: { type: "italic", text: `via ${source}` } });
  blocks.push({ type: "paragraph", text: firmLine(report) });
  blocks.push({ type: "paragraph", text: { type: "bold", text: summaryLine(report) } });
  if (checks.length) {
    const rows = [[cell("Check", { is_header: true }), cell("Result", { is_header: true }), cell("Page", { is_header: true })]];
    for (const c of checks) {
      const p = pageOf(c);
      rows.push([
        cell(c.title),
        cell(`${ICON[c.state] || "•"} ${c.label}`),
        cell(p ? { type: "url", text: p.short, url: p.url } : "—"),
      ]);
    }
    blocks.push({ type: "table", cells: rows, is_bordered: true, is_striped: true, is_compact: true });
  }
  const ai = aiLine(report);
  if (ai) blocks.push({ type: "paragraph", text: ai });
  blocks.push({ type: "paragraph", text: [{ type: "bold", text: "Evidence fingerprint (SHA3-256): " }, { type: "code", text: report.record_hash }] });
  blocks.push({ type: "paragraph", text: [{ type: "bold", text: "Timestamp: " }, { type: "date_time", text: at, unix_time: unix, date_time_format: "" }, " (UTC)"] });
  blocks.push({
    type: "document",
    document: { type: "document", media: "attach://record" },
    caption: { text: "The sealed scan record. Its SHA3-256 is the fingerprint above, so anyone can check it has not changed." },
  });
  if (buttons.length) blocks.push({ type: "buttons", buttons, align: "left" });
  blocks.push({ type: "footer", text: "Automated free scan by sha3.si (Servolia LLC). It points to gaps; it is not legal advice." });

  return {
    rich: { blocks, skip_entity_detection: true },
    text: plainText(report, { heading, source: audience === "owner" ? source : "" }),
    keyboard: buttons.length ? { inline_keyboard: buttons.map((b) => [{ text: b.text, url: b.url }]) } : null,
    file: recordFile(report),
  };
}

// The fallback: one plain message (no parse mode, so nothing can fail to
// parse), the same buttons as an inline keyboard, then the record as a file.
export function plainText(report, { heading = `MiCA website scan: ${hostOf(report)}`, source = "" } = {}) {
  const lines = [heading];
  if (source) lines.push(`via ${source}`);
  lines.push(firmLine(report), summaryLine(report), "");
  for (const c of report.checks || []) {
    const p = pageOf(c);
    lines.push(`${ICON[c.state] || "•"} ${c.title}: ${c.label}${p ? ` (${p.short})` : ""}`);
  }
  const ai = aiLine(report);
  if (ai) lines.push("", ai);
  lines.push("", "Evidence fingerprint (SHA3-256):", report.record_hash, `Timestamp: ${report.scanned_at} (UTC)`);
  const text = lines.join("\n");
  return text.length > 4000 ? text.slice(0, 3999) + "…" : text;
}

// A short notice (payments, audits, monitors) as a rich message.
export function noticeMessage(title, rows = [], { lines = [], button = null } = {}) {
  const blocks = [{ type: "heading", size: 3, text: `sha3.si: ${title}` }];
  if (rows.length) blocks.push({ type: "table", cells: rows.map(([k, v]) => [cell(String(k), { is_header: true }), cell(String(v))]), is_bordered: true, is_compact: true });
  for (const line of lines) blocks.push({ type: "paragraph", text: String(line) });
  if (button) blocks.push({ type: "buttons", buttons: [{ text: button.text, url: button.url, style: "primary" }] });
  const text = [`sha3.si: ${title}`, ...rows.map(([k, v]) => `${k}: ${v}`), ...lines].join("\n");
  return { rich: { blocks, skip_entity_detection: true }, text: text.slice(0, 4000), keyboard: button ? { inline_keyboard: [[button]] } : null, file: null };
}

/* -------------------------------------------------------------- sending */

// Rich first; on any refusal, the plain fallback. Never throws.
export async function sendRich(tokenValue, chatId, msg, opts = {}) {
  try {
    const base = { chat_id: chatId, disable_notification: opts.silent || undefined };
    const r = await call(tokenValue, "sendRichMessage", { ...base, rich_message: msg.rich }, msg.file ? [msg.file] : []);
    if (r.ok) return { ok: true, mode: "rich", message_id: r.result && r.result.message_id };
    const p = await call(tokenValue, "sendMessage", {
      ...base, text: msg.text, link_preview_options: { is_disabled: true }, reply_markup: msg.keyboard || undefined,
    });
    if (p.ok && msg.file) {
      await call(tokenValue, "sendDocument", { ...base, document: "attach://record", caption: "Sealed scan record (canonical JSON); its SHA3-256 is the fingerprint." }, [msg.file]);
    }
    return { ok: Boolean(p.ok), mode: "plain", rich_error: r.description || null, error: p.ok ? null : p.description };
  } catch (e) {
    return { ok: false, mode: "none", error: e.message };
  }
}

export async function sendText(tokenValue, chatId, text, extra = {}) {
  try {
    return await call(tokenValue, "sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true }, ...extra });
  } catch (e) {
    return { ok: false, description: e.message };
  }
}

/* ---------------------------------------------------------- owner alerts */

export async function alertScan(report, { id, token, source = "website" } = {}) {
  if (!alertsConfigured()) return { ok: false, skipped: true };
  return sendRich(alertToken(), ownerChat(), scanMessage(report, { id, token, audience: "owner", source }), { silent: true });
}

export async function alertNotice(title, rows = [], opts = {}) {
  if (!alertsConfigured()) return { ok: false, skipped: true };
  return sendRich(alertToken(), ownerChat(), noticeMessage(title, rows, opts));
}
