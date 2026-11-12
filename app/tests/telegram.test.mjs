// node --test tests/telegram.test.mjs   (no network: fetch is replaced)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

process.env.LOCAL_DB = join(mkdtempSync(join(tmpdir(), "sha3si-tg-")), "test.db");
process.env.TELEGRAM_CUSTOMER_BOT_TOKEN = "123456:test-token";
process.env.TELEGRAM_CHAT_ID = "4242";
process.env.IP_SALT = "test-salt";

const tg = await import("../lib/telegram.js");
const { seal } = await import("../lib/store.js");
const { sha3 } = await import("../lib/evidence.js");
const { PLANS } = await import("../lib/stripe.js");
const { rateLimit } = await import("../lib/http.js");
const webhook = (await import("../api/telegram.js")).default;
const { siteIn } = await import("../api/telegram.js");

const REPORT = seal({
  v: 1,
  scanned_from: { place: "Frankfurt, Germany", region: "fra1" },
  target: { input: "example-exchange.eu", url: "https://example-exchange.eu/", final_url: "https://www.example-exchange.eu/", host: "www.example-exchange.eu" },
  firm: { name: "Example Exchange GmbH", lei: "529900EXAMPLE0000001" },
  checks: [
    { id: "licence", title: "Authorisation statement", state: "ok", label: "Found, linked from the homepage", page: { url: "https://www.example-exchange.eu/", sha3_256: "a".repeat(64), status: 200 } },
    { id: "fees", title: "Pricing, costs and fees policy", state: "missing", label: "Not found" },
    { id: "complaints", title: "Complaints procedure", state: "two_clicks", label: "Found, two clicks from the homepage", link: { text: "Complaints", href: "https://www.example-exchange.eu/legal/complaints-handling-procedure-for-retail-clients" } },
    { id: "risk", title: "Risk warning", state: "review", label: "Needs a human look" },
  ],
  score: { passed: 2, gaps: 1, review: 1, applicable: 4 },
  ai: { findings: [{}, {}, {}] },
}, "free");

// Field names allowed per object, copied from the Bot API page (2026-11-12).
const BLOCK_FIELDS = {
  heading: ["type", "text", "size"], paragraph: ["type", "text"], footer: ["type", "text"],
  table: ["type", "cells", "is_bordered", "is_striped", "is_compact", "caption"],
  document: ["type", "document", "caption"], buttons: ["type", "buttons", "align"],
};
const CELL_FIELDS = ["text", "is_header", "colspan", "rowspan", "align", "valign"];
const BUTTON_FIELDS = ["text", "style", "url", "callback_data", "web_app", "login_url", "switch_inline_query",
  "switch_inline_query_current_chat", "switch_inline_query_chosen_chat", "copy_text", "disabled"];
const RICH_FIELDS = { bold: ["type", "text"], italic: ["type", "text"], code: ["type", "text"], url: ["type", "text", "url"],
  date_time: ["type", "text", "unix_time", "date_time_format"] };

function checkRichText(t, where) {
  if (typeof t === "string") return;
  if (Array.isArray(t)) return t.forEach((x, i) => checkRichText(x, `${where}[${i}]`));
  assert.ok(RICH_FIELDS[t.type], `${where}: rich text type ${t.type}`);
  for (const k of Object.keys(t)) assert.ok(RICH_FIELDS[t.type].includes(k), `${where}: field ${k} on ${t.type}`);
  checkRichText(t.text, where + ".text");
}

test("rich scan message uses only documented fields", () => {
  const m = tg.scanMessage(REPORT, { id: REPORT.id, token: "tok", audience: "customer" });
  assert.deepEqual(Object.keys(m.rich).sort(), ["blocks", "skip_entity_detection"]);
  for (const [i, b] of m.rich.blocks.entries()) {
    assert.ok(BLOCK_FIELDS[b.type], `block ${i} type ${b.type}`);
    for (const k of Object.keys(b)) assert.ok(BLOCK_FIELDS[b.type].includes(k), `block ${b.type} field ${k}`);
    if (b.text !== undefined) checkRichText(b.text, b.type);
    if (b.type === "table") {
      for (const row of b.cells) for (const c of row) {
        for (const k of Object.keys(c)) assert.ok(CELL_FIELDS.includes(k), `cell field ${k}`);
        assert.ok(["left", "center", "right"].includes(c.align) && ["top", "middle", "bottom"].includes(c.valign), "align and valign are required");
        checkRichText(c.text, "cell");
      }
    }
    if (b.type === "buttons") {
      assert.ok(b.buttons.length >= 1 && b.buttons.length <= 8);
      for (const btn of b.buttons) for (const k of Object.keys(btn)) assert.ok(BUTTON_FIELDS.includes(k), `button field ${k}`);
    }
    if (b.type === "document") {
      assert.deepEqual(b.document, { type: "document", media: "attach://record" });
      assert.ok(typeof b.caption.text === "string");
    }
  }
});

test("scan message content: heading, table, fingerprint, document, buy button", () => {
  const m = tg.scanMessage(REPORT, { id: REPORT.id, token: "tok", audience: "customer" });
  const [head] = m.rich.blocks;
  assert.equal(head.type, "heading");
  assert.equal(head.text, "MiCA website scan: example-exchange.eu");
  const table = m.rich.blocks.find((b) => b.type === "table");
  assert.equal(table.cells.length, 1 + REPORT.checks.length);
  assert.deepEqual(table.cells[0].map((c) => c.text), ["Check", "Result", "Page"]);
  assert.ok(table.cells[0].every((c) => c.is_header));
  assert.equal(table.cells[1][2].text.type, "url");
  assert.equal(table.cells[1][2].text.url, "https://www.example-exchange.eu/");
  assert.equal(table.cells[2][2].text, "—");
  assert.ok(table.cells[3][2].text.text.length <= 32, "long paths are shortened");
  const json = JSON.stringify(m.rich);
  assert.ok(json.includes(REPORT.record_hash));
  assert.ok(json.includes(REPORT.scanned_at));
  assert.equal(m.rich.blocks.filter((b) => b.type === "document").length, 1);
  const buttons = m.rich.blocks.find((b) => b.type === "buttons").buttons;
  assert.equal(buttons[0].text, `Buy the full audit (${tg.eur(PLANS.audit.amount)})`);
  assert.equal(buttons[0].url, `https://sha3.si/r/?id=${REPORT.id}&t=tok&buy=audit`);
  assert.equal(m.keyboard.inline_keyboard[0][0].url, buttons[0].url);
});

test("owner variant has no buy button; no private link falls back to pricing", () => {
  const o = tg.scanMessage(REPORT, { id: REPORT.id, token: "tok", audience: "owner", source: "website" });
  const btns = o.rich.blocks.find((b) => b.type === "buttons").buttons.map((b) => b.text);
  assert.deepEqual(btns, ["Open the report", "Evidence record"]);
  assert.ok(o.rich.blocks[0].text.startsWith("New scan: "));
  const c = tg.scanMessage(REPORT, {});
  const cb = c.rich.blocks.find((b) => b.type === "buttons").buttons;
  assert.equal(cb.length, 1);
  assert.equal(cb[0].url, "https://sha3.si/?host=example-exchange.eu#pricing");
});

test("euro labels", () => {
  assert.equal(tg.eur(149000), "EUR 1,490");
  assert.equal(tg.eur(29000), "EUR 290");
});

test("the attached record hashes to the fingerprint", () => {
  const f = tg.recordFile(REPORT);
  assert.equal(sha3(f.bytes), REPORT.record_hash);
  assert.equal(f.filename, `sha3si-example-exchange.eu-${REPORT.id}.json`);
  assert.ok(!JSON.parse(f.bytes.toString()).record_hash);
});

test("plain-text fallback carries every check and the fingerprint", () => {
  const t = tg.plainText(REPORT);
  for (const c of REPORT.checks) assert.ok(t.includes(c.title));
  assert.ok(t.includes(REPORT.record_hash));
  assert.ok(t.length < 4096);
  const many = { ...REPORT, checks: Array.from({ length: 200 }, (_, i) => ({ title: "Check " + i + " ".repeat(30), label: "x", state: "ok" })) };
  assert.ok(tg.plainText(many).length <= 4000);
});

/* ------------------------------------------------------ fetch stand-in */
let calls = [];
let script = () => ({ ok: true, result: { message_id: 1 } });
globalThis.fetch = async (url, init) => {
  const method = String(url).split("/").pop();
  let body = null;
  if (init.body instanceof FormData) {
    body = {};
    for (const [k, v] of init.body.entries()) body[k] = typeof v === "string" ? v : { file: v.name, size: v.size };
  } else body = JSON.parse(init.body);
  calls.push({ url: String(url), method, body });
  const j = script(method, body);
  return new Response(JSON.stringify(j), { status: j.ok ? 200 : 400 });
};

test("sendRich: rich message goes out as multipart with the record attached", async () => {
  calls = [];
  script = () => ({ ok: true, result: { message_id: 7 } });
  const r = await tg.sendRich("T", 4242, tg.scanMessage(REPORT, { id: REPORT.id, token: "tok" }));
  assert.deepEqual(r, { ok: true, mode: "rich", message_id: 7 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "sendRichMessage");
  assert.ok(calls[0].url.startsWith("https://api.telegram.org/botT/"));
  assert.equal(JSON.parse(calls[0].body.rich_message).blocks[0].type, "heading");
  assert.equal(calls[0].body.chat_id, "4242");
  assert.match(calls[0].body.record.file, /^sha3si-example-exchange\.eu-.*\.json$/);
});

test("sendRich: a refused rich message falls back to text, buttons and the file", async () => {
  calls = [];
  script = (m) => (m === "sendRichMessage" ? { ok: false, error_code: 400, description: "Bad Request: unknown block" } : { ok: true, result: {} });
  const r = await tg.sendRich("T", 4242, tg.scanMessage(REPORT, { id: REPORT.id, token: "tok" }));
  assert.equal(r.mode, "plain");
  assert.equal(r.ok, true);
  assert.equal(r.rich_error, "Bad Request: unknown block");
  assert.deepEqual(calls.map((c) => c.method), ["sendRichMessage", "sendMessage", "sendDocument"]);
  assert.ok(calls[1].body.text.includes(REPORT.record_hash));
  assert.ok(!("parse_mode" in calls[1].body), "plain text, no parse mode");
  assert.ok(calls[1].body.reply_markup.inline_keyboard[0][0].text.startsWith("Buy the full audit"));
  assert.equal(calls[2].body.document, "attach://record");
});

test("sendRich never throws", async () => {
  script = () => { throw new Error("boom"); };
  const r = await tg.sendRich("T", 1, tg.noticeMessage("x"));
  assert.equal(r.ok, false);
});

test("owner alerts: skipped without a chat, sent silently with one", async () => {
  const keep = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_CHAT_ID;
  assert.deepEqual(await tg.alertScan(REPORT), { ok: false, skipped: true });
  process.env.TELEGRAM_CHAT_ID = keep;
  calls = [];
  script = () => ({ ok: true, result: { message_id: 2 } });
  const r = await tg.alertScan(REPORT, { id: REPORT.id, token: "tok", source: "website" });
  assert.equal(r.mode, "rich");
  assert.equal(calls[0].body.disable_notification, "true");
  assert.ok(calls[0].url.includes(process.env.TELEGRAM_CUSTOMER_BOT_TOKEN), "falls back to the customer bot token");
});

test("notice table for a paid order", () => {
  const n = tg.noticeMessage("paid: MiCA website audit", [["Site", "a.eu"], ["Amount", "290.00 EUR"]], { lines: ["next"] });
  assert.equal(n.rich.blocks[1].type, "table");
  assert.ok(n.text.includes("Amount: 290.00 EUR"));
});

/* ------------------------------------------------------------- webhook */
function req(body, headers = {}) {
  const r = Readable.from([Buffer.from(JSON.stringify(body))]);
  r.method = "POST";
  r.headers = headers;
  return r;
}
function res() {
  return { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b || ""; } };
}
const SECRET = { "x-telegram-bot-api-secret-token": tg.webhookSecret() };
let uid = 1000;
const msg = (text, extra = {}) => ({ update_id: uid++, message: { message_id: 1, from: { id: 99 }, chat: { id: 99, type: "private" }, text, ...extra } });

test("webhook: secret required", async () => {
  const r = res();
  await webhook(req(msg("/start")), r);
  assert.equal(r.statusCode, 401);
  const r2 = res();
  await webhook(req(msg("/start"), { "x-telegram-bot-api-secret-token": "0".repeat(64) }), r2);
  assert.equal(r2.statusCode, 401);
});

test("webhook: 503 without the customer bot token", async () => {
  const keep = process.env.TELEGRAM_CUSTOMER_BOT_TOKEN;
  delete process.env.TELEGRAM_CUSTOMER_BOT_TOKEN;
  const r = res();
  await webhook(req(msg("/start"), SECRET), r);
  process.env.TELEGRAM_CUSTOMER_BOT_TOKEN = keep;
  assert.equal(r.statusCode, 503);
});

test("webhook: /start answers, a redelivered update is ignored, groups are ignored", async () => {
  calls = [];
  script = () => ({ ok: true, result: {} });
  const u = msg("/start");
  const r = res();
  await webhook(req(u, SECRET), r);
  assert.equal(r.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "sendMessage");
  assert.match(calls[0].body.text, /MiCA/);
  const again = res();
  await webhook(req(u, SECRET), again);
  assert.equal(JSON.parse(again.body).duplicate, true);
  assert.equal(calls.length, 1);
  const g = res();
  await webhook(req(msg("coinhouse.com", { chat: { id: -5, type: "group" } }), SECRET), g);
  assert.equal(JSON.parse(g.body).ignored, true);
  assert.equal(calls.length, 1);
});

test("webhook: text without a website gets the help", async () => {
  calls = [];
  const r = res();
  await webhook(req(msg("hello there"), SECRET), r);
  assert.match(calls[0].body.text, /Send a website address/);
});

test("webhook: rate limited like the free scan", async () => {
  const key = "scan:tg:" + createHash("sha256").update("test-salt" + "tg:" + 555).digest("hex").slice(0, 32);
  for (let i = 0; i < 8; i++) await rateLimit(key, 8, 3600);
  calls = [];
  const r = res();
  await webhook(req(msg("coinhouse.com", { from: { id: 555 }, chat: { id: 555, type: "private" } }), SECRET), r);
  assert.equal(JSON.parse(r.body).limited, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.text, /Too many scans/);
});

test("website addresses in messages", () => {
  assert.equal(siteIn("coinhouse.com"), "coinhouse.com");
  assert.equal(siteIn("please check https://www.bitpanda.com/en please"), "https://www.bitpanda.com/en");
  assert.equal(siteIn("(kraken.com)."), "kraken.com");
  assert.equal(siteIn("hello there"), null);
  assert.equal(siteIn("1.5 is a number"), null);
});
