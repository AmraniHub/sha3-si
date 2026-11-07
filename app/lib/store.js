// Saving and reading scans, evidence pages and orders.
import zlib from "node:zlib";
import { randomBytes } from "node:crypto";
import * as db from "./db.js";
import { newId, recordHash } from "./evidence.js";

const KEEP_BODIES = new Set(["homepage", "legal-page", "fees", "sustainability", "complaints", "whitepapers", "risk", "asset-page"]);

export function token() {
  return randomBytes(18).toString("base64url");
}

// Seal a report: give it an id, a time and its own SHA3-256 record hash.
export function seal(report, kind) {
  const sealed = { ...report, id: report.id || newId(), kind, scanned_at: report.scanned_at || new Date().toISOString() };
  delete sealed.record_hash;
  sealed.record_hash = recordHash(sealed);
  return sealed;
}

// No IP address or hash is ever stored with a scan (see /privacy/).
export async function saveScan(report, pages, { orderId = null } = {}) {
  const t = token();
  const statements = [[
    `INSERT INTO scans (id, token, created_at, day, host, lei, firm, kind, order_id, ai, passed, gaps, review, applicable, report, record_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [report.id, t, report.scanned_at, report.scanned_at.slice(0, 10), report.target.host.replace(/^www\./, ""),
      report.firm ? report.firm.lei : null, report.firm ? report.firm.name : null, report.kind, orderId,
      // A review reused from an earlier scan is not a fresh one: it must not be
      // reused again, or a site scanned daily keeps an old review forever.
      report.ai && report.ai.findings && !report.ai.reused ? 1 : 0,
      report.score ? report.score.passed : null, report.score ? report.score.gaps : null,
      report.score ? report.score.review : null, report.score ? report.score.applicable : null,
      JSON.stringify(report), report.record_hash],
  ]];
  for (const p of pages || []) {
    if (!p.body || !p.sha3_256 || !KEEP_BODIES.has(p.role)) continue;
    statements.push([
      "INSERT OR IGNORE INTO pages (sha3_256, url, fetched_at, status, content_type, bytes, body_gz) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [p.sha3_256, p.final_url || p.url, p.fetched_at, p.status, p.content_type || "", p.bytes, zlib.gzipSync(p.body).toString("base64")],
    ]);
  }
  await db.batch(statements);
  return t;
}

export async function getScan(id, tokenValue) {
  const row = await db.one("SELECT token, report FROM scans WHERE id = ?", [String(id || "")]);
  if (!row || !tokenValue || row.token !== String(tokenValue)) return null;
  return JSON.parse(row.report);
}

export async function recentScan(host, minutes, kind = "free", lei = null) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const row = await db.one(
    "SELECT id, token, report FROM scans WHERE host = ? AND kind = ? AND COALESCE(lei, '') = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1",
    [host.replace(/^www\./, ""), kind, lei || "", since],
  );
  return row ? { id: row.id, token: row.token, report: JSON.parse(row.report) } : null;
}

// A free scan may reuse today's free AI review of the same site and firm,
// never the review in a paid audit or monitor scan.
export async function aiReviewedToday(host, lei) {
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const rows = await db.all(
    "SELECT report FROM scans WHERE host = ? AND kind = 'free' AND ai = 1 AND COALESCE(lei, '') = ? AND created_at > ? ORDER BY created_at DESC LIMIT 5",
    [host.replace(/^www\./, ""), lei || "", since],
  );
  for (const r of rows) {
    const rep = JSON.parse(r.report);
    if (rep.ai && rep.ai.findings) return rep.ai;
  }
  return null;
}

export async function pageBody(sha3hex) {
  const row = await db.one("SELECT url, fetched_at, status, content_type, bytes, body_gz FROM pages WHERE sha3_256 = ?", [sha3hex]);
  if (!row) return null;
  return { ...row, body: zlib.gunzipSync(Buffer.from(row.body_gz, "base64")) };
}

export async function createOrder({ plan, email, host, scanId }) {
  const id = "ord_" + newId(10);
  const t = token();
  const now = new Date().toISOString();
  await db.run(
    "INSERT INTO orders (id, created_at, updated_at, plan, status, email, host, scan_id, token) VALUES (?, ?, ?, ?, 'created', ?, ?, ?, ?)",
    [id, now, now, plan, email || null, host || null, scanId || null, t],
  );
  return { id, token: t };
}

export async function getOrder(id) {
  return db.one("SELECT * FROM orders WHERE id = ?", [String(id || "")]);
}
