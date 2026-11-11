// Owner-only. Authorization: Bearer ADMIN_KEY.
// GET  /api/admin                              -> leads, orders, recent scans, AI spend, anchors
// POST /api/admin {action: "connect_stripe"}   -> create the Stripe webhook endpoint and keep its secret
// POST /api/admin {action: "prospect", url, ai} -> scan a prospect and return a private report link
import { timingSafeEqual } from "node:crypto";
import { send, jsonBody } from "../lib/http.js";
import * as db from "../lib/db.js";
import { stripe, mode, WEBHOOK_EVENTS, API_VERSION, SITE } from "../lib/stripe.js";
import { scan } from "../lib/scanner.js";
import { review } from "../lib/review.js";
import { seal, saveScan } from "../lib/store.js";
import { sendMail, mailConfigured } from "../lib/mail.js";

function authorised(req) {
  const keyValue = process.env.ADMIN_KEY || "";
  const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (keyValue.length < 24 || got.length !== keyValue.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(keyValue));
}

function appUrl(req) {
  return process.env.APP_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

export default async function handler(req, res) {
  if (!authorised(req)) return send(res, 401, { error: "unauthorised" });
  if (!db.enabled) return send(res, 503, { error: "no database" });
  if (req.method === "GET") {
    const month = new Date().toISOString().slice(0, 7);
    const [leads, orders, scans, spend, anchors] = await Promise.all([
      db.all("SELECT * FROM leads ORDER BY created_at DESC LIMIT 100"),
      db.all("SELECT id, created_at, updated_at, plan, status, attempts, note, email, host, amount, currency, stripe_customer FROM orders ORDER BY created_at DESC LIMIT 100"),
      db.all("SELECT id, token, created_at, host, firm, kind, passed, gaps, review, applicable FROM scans ORDER BY created_at DESC LIMIT 100"),
      db.all("SELECT scope, SUM(usd) AS usd, SUM(calls) AS calls FROM ai_usage WHERE day LIKE ? GROUP BY scope", [month + "%"]),
      db.all("SELECT day, records, status, bitcoin_block FROM anchors ORDER BY day DESC LIMIT 30"),
    ]);
    return send(res, 200, { payments: mode(), leads, orders, scans, ai_spend_this_month: spend, anchors });
  }
  const b = await jsonBody(req).catch(() => ({}));
  if (b.action === "connect_stripe") {
    if (mode() === "off") return send(res, 409, { error: "STRIPE_SECRET_KEY is not set" });
    const url = `${appUrl(req)}/api/stripe-webhook`;
    const existing = await stripe("GET", "/webhook_endpoints", { limit: 100 });
    for (const ep of existing.data || []) {
      if (ep.url === url) await stripe("DELETE", `/webhook_endpoints/${ep.id}`);
    }
    const ep = await stripe("POST", "/webhook_endpoints", {
      url, api_version: API_VERSION, enabled_events: WEBHOOK_EVENTS, description: "sha3.si " + mode(),
    });
    await db.run(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ["stripe_webhook_secret_" + mode(), ep.secret, new Date().toISOString()],
    );
    return send(res, 200, { ok: true, endpoint: ep.id, url, events: WEBHOOK_EVENTS, mode: mode() });
  }
  if (b.action === "prospect") {
    const { report, material, pages } = await scan({ input: b.url, lei: b.lei });
    if (b.ai && material && !report.unreadable) report.ai = await review(report, material, "audit");
    const sealed = seal(report, "prospect");
    const tokenValue = await saveScan(sealed, pages);
    return send(res, 200, {
      ok: true, score: sealed.score, gaps: sealed.checks.filter((c) => ["missing", "broken", "not_linked"].includes(c.state)).map((c) => c.title),
      ai: sealed.ai ? (sealed.ai.skipped ? sealed.ai.skipped : `${sealed.ai.findings.length} findings, USD ${sealed.ai.cost_usd}`) : null,
      link: `${SITE}/r/?id=${sealed.id}&t=${tokenValue}`, record_hash: sealed.record_hash,
    });
  }
  if (b.action === "test_mail") {
    if (!mailConfigured) return send(res, 409, { error: "RESEND_API_KEY or MAIL_FROM is not set" });
    const ok = await sendMail({ to: b.to || "hello@sha3.si", subject: "sha3.si sending test",
      text: "This is a test of the emails sha3.si sends to clients (weekly monitor alerts). No action needed." });
    return send(res, ok ? 200 : 502, { ok, from: process.env.MAIL_FROM });
  }
  return send(res, 400, { error: "unknown action" });
}
