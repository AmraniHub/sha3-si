// GET /api/cron   (Vercel Cron, hourly; Authorization: Bearer CRON_SECRET)
// 1. Anchor each finished day's scan records in Bitcoin (OpenTimestamps).
// 2. Ask the calendars whether pending anchors have confirmed.
// 3. Run the automatic part of paid audits (scan + Claude review, high effort).
// 4. Re-scan monitored sites once a week and flag what changed.
import { send } from "../lib/http.js";
import * as db from "../lib/db.js";
import { merkleRoot, anchorText, sha256Bytes } from "../lib/evidence.js";
import { stamp, upgrade } from "../lib/ots.js";
import { scan } from "../lib/scanner.js";
import { review } from "../lib/review.js";
import { seal, saveScan } from "../lib/store.js";
import { alert } from "../lib/alert.js";
import { sendMail } from "../lib/mail.js";
import { SITE } from "../lib/stripe.js";

const now = () => new Date().toISOString();
const MAX_SCANS_PER_RUN = 3;

async function anchorDays(log) {
  const today = now().slice(0, 10);
  const days = await db.all(
    "SELECT DISTINCT day FROM scans WHERE day < ? AND day NOT IN (SELECT day FROM anchors) ORDER BY day LIMIT 5", [today]);
  for (const { day } of days) {
    const leaves = (await db.all("SELECT record_hash FROM scans WHERE day = ?", [day])).map((r) => r.record_hash);
    const root = merkleRoot(leaves);
    const text = anchorText(day, root, new Set(leaves).size);
    let ots = null;
    try {
      ots = (await stamp(sha256Bytes(Buffer.from(text, "utf8")))).toString("base64");
    } catch (e) {
      log.push(`anchor ${day}: calendars unreachable (${e.message}), retrying next run`);
      continue;
    }
    await db.run("INSERT OR IGNORE INTO anchors (day, root, records, file_text, ots_b64, status, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      [day, root, new Set(leaves).size, text, ots, now()]);
    log.push(`anchor ${day}: ${leaves.length} records, root ${root.slice(0, 12)}, submitted`);
  }
}

async function upgradeAnchors(log) {
  const before = new Date(Date.now() - 3600000).toISOString();
  const rows = await db.all("SELECT day, ots_b64 FROM anchors WHERE status = 'pending' AND updated_at < ? LIMIT 10", [before]);
  for (const r of rows) {
    const up = await upgrade(Buffer.from(r.ots_b64, "base64"));
    const confirmed = up.bitcoin_blocks.length > 0;
    await db.run("UPDATE anchors SET ots_b64 = ?, status = ?, bitcoin_block = ?, updated_at = ? WHERE day = ?",
      [up.bytes.toString("base64"), confirmed ? "confirmed" : "pending", confirmed ? up.bitcoin_blocks[0] : null, now(), r.day]);
    log.push(`anchor ${r.day}: ${confirmed ? "in Bitcoin block " + up.bitcoin_blocks[0] : "still pending"}`);
  }
}

function diff(prev, next) {
  const changes = [];
  const before = Object.fromEntries((prev.checks || []).map((c) => [c.id, c]));
  for (const c of next.checks || []) {
    const p = before[c.id];
    if (!p) continue;
    if (p.state !== c.state) changes.push(`${c.title}: ${p.label} -> ${c.label}`);
    else if (p.page && c.page && p.page.sha3_256 !== c.page.sha3_256) changes.push(`${c.title}: page content changed (${c.page.url})`);
  }
  return changes;
}

const MAX_ATTEMPTS = 3;

async function runScan(order, kind, log) {
  const { report, material, pages } = await scan({ input: "https://" + order.host });
  if (material && !report.unreadable) report.ai = await review(report, material, kind === "audit" ? "audit" : "monitor");
  // Compare with the last READABLE scan, so a link that breaks during a week
  // the site could not be read is still reported the week after.
  const previous = await db.one("SELECT report FROM scans WHERE order_id = ? AND kind IN ('audit', 'monitor') AND passed IS NOT NULL ORDER BY created_at DESC LIMIT 1", [order.id]);
  const sealed = seal({ ...report, order: order.id }, kind);
  if (previous && !sealed.unreadable) sealed.changes = diff(JSON.parse(previous.report), sealed);
  await saveScan(sealed, pages, { orderId: order.id });
  log.push(`${kind} ${order.host}: ${sealed.unreadable ? "unreadable" : `${sealed.score.gaps} gaps`}${sealed.changes ? `, ${sealed.changes.length} changes` : ""}`);
  return sealed;
}

// Count a failed attempt; after MAX_ATTEMPTS the order waits for a person.
// The attempt was already counted before the scan started (so a run killed at
// the time limit still counts). The order's status is never changed here: an
// annual customer whose audit is stuck must keep the weekly monitor.
async function failAttempt(order, why) {
  const attempts = order.attempts;
  const stuck = attempts >= MAX_ATTEMPTS;
  await db.run("UPDATE orders SET note = ?, updated_at = ? WHERE id = ?", [why, now(), order.id]);
  await alert(stuck ? "PAID AUDIT NEEDS YOU" : "audit attempt failed, will retry", [order.host, why, `attempt ${attempts} of ${MAX_ATTEMPTS}`, `order ${order.id}`, order.email || ""]);
}

// A paid audit counts as done only when the site was readable AND Claude's
// review ran. Anything less is an attempt, never silently a delivery.
async function audits(log, budget) {
  const due = await db.all(
    `SELECT * FROM orders o WHERE o.host IS NOT NULL AND o.attempts < ? AND (
       (o.plan = 'audit' AND o.status = 'paid') OR (o.plan = 'monitor_year' AND o.status = 'active'))
     AND NOT EXISTS (SELECT 1 FROM scans s WHERE s.order_id = o.id AND s.kind = 'audit' AND s.ai = 1)
     ORDER BY o.created_at LIMIT ?`, [MAX_ATTEMPTS, budget.left]);
  for (const order of due) {
    if (budget.left-- <= 0) break;
    await db.run("UPDATE orders SET attempts = attempts + 1, updated_at = ? WHERE id = ?", [now(), order.id]);
    order.attempts = (order.attempts || 0) + 1;
    try {
      const sealed = await runScan(order, "audit", log);
      if (sealed.unreadable) await failAttempt(order, (sealed.limits || [])[0] || "the site could not be read");
      else if (!sealed.ai || !sealed.ai.findings) await failAttempt(order, `Claude review did not run: ${(sealed.ai && sealed.ai.skipped) || "unknown"}`);
      else await alert("audit draft ready for review", [order.host, `${sealed.score.gaps} gaps, ${sealed.score.review} to review`, `order ${order.id}`, order.email || "", "Human check and report due within 48 h of payment."]);
    } catch (e) {
      await failAttempt(order, `scan crashed: ${e.message}`);
    }
  }
}

async function monitors(log, budget) {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const due = await db.all(
    `SELECT * FROM orders o WHERE o.plan IN ('monitor_month', 'monitor_year') AND o.status = 'active' AND o.host IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM scans s WHERE s.order_id = o.id AND s.kind IN ('audit', 'monitor') AND s.created_at > ?)
     ORDER BY o.created_at LIMIT ?`, [weekAgo, budget.left]);
  for (const order of due) {
    if (budget.left-- <= 0) break;
    try {
      const sealed = await runScan(order, "monitor", log);
      const account = `${SITE}/account/?o=${order.id}&t=${order.token}`;
      if (sealed.unreadable) {
        await alert("monitor: site unreadable this week", [order.host, (sealed.limits || [])[0] || "", `order ${order.id}`]);
      } else if (sealed.changes && sealed.changes.length) {
        const mailed = await sendMail({
          to: order.email,
          subject: `sha3.si: ${sealed.changes.length} change${sealed.changes.length === 1 ? "" : "s"} on ${order.host}`,
          text: `This week's scan of ${order.host}, read from ${sealed.scanned_from.place}, found:\n\n- ${sealed.changes.join("\n- ")}\n\nReport and evidence: ${account}\n\nThese are observations of what the website showed, not legal advice.\nsha3.si, a service of Servolia LLC`,
        });
        await alert("monitor: changes found", [order.host, ...sealed.changes.slice(0, 8), mailed ? "client emailed" : `EMAIL THE CLIENT: ${order.email || "(no email)"}`, `order ${order.id}`]);
      }
    } catch (e) {
      log.push(`monitor ${order.host} crashed: ${e.message}`);
      await alert("monitor scan crashed", [order.host, e.message, `order ${order.id}`]);
    }
  }
}

// Rate-limit rows hold a salted IP hash; they are deleted once their hour is up.
async function cleanup(log) {
  const n = await db.run("DELETE FROM rate WHERE reset_at < ?", [now()]);
  if (n) log.push(`rate: ${n} expired rows deleted`);
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: "unauthorised" });
  if (!db.enabled) return send(res, 503, { error: "no database" });
  const log = [];
  const budget = { left: MAX_SCANS_PER_RUN };
  const steps = [["cleanup", cleanup], ["anchor", anchorDays], ["upgrade", upgradeAnchors], ["audits", (l) => audits(l, budget)], ["monitors", (l) => monitors(l, budget)]];
  for (const [name, fn] of steps) {
    try {
      await fn(log);
    } catch (e) {
      log.push(`${name} failed: ${e.message}`);
    }
  }
  return send(res, 200, { ok: true, at: now(), log });
}
