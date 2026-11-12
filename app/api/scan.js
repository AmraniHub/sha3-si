// POST /api/scan {url | lei}  -> NDJSON stream of progress events, then the
//                               sealed report (and its private link when stored)
// GET  /api/scan?id=..&t=..     -> a stored report, for its private link
import { cors, send, jsonBody, ipHash, rateLimit } from "../lib/http.js";
import { normalizeInput } from "../lib/scanner.js";
import * as db from "../lib/db.js";
import { getScan } from "../lib/store.js";
import { freeScan } from "../lib/freescan.js";
import { alertScan } from "../lib/telegram.js";
import { firmByLei } from "../lib/register.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method === "GET") {
    const q = new URL(req.url, "http://x").searchParams;
    if (!db.enabled) return send(res, 503, { error: "Reports are not stored yet." });
    const report = await getScan(q.get("id"), q.get("t"));
    return report ? send(res, 200, { report }) : send(res, 404, { error: "No report at this link." });
  }
  if (req.method !== "POST") return send(res, 405, { error: "POST a website to scan." });

  let body;
  try {
    body = await jsonBody(req);
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
  let target;
  try {
    const firm = body.lei ? firmByLei(body.lei) : null;
    target = normalizeInput(body.url || (firm && firm.w[0]));
  } catch (e) {
    return send(res, 400, { error: e.code === "EINPUT" ? e.message : "That does not look like a website address." });
  }

  if (!(await rateLimit("scan:" + ipHash(req), 8, 3600)) || !(await rateLimit("scan:all", 400, 3600))) {
    return send(res, 429, { error: "Too many scans from here in the last hour. Try again later, or ask us for the full audit." });
  }

  res.statusCode = 200;
  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-accel-buffering", "no");
  if (res.flushHeaders) res.flushHeaders();
  const emit = (type, data = {}) => res.write(JSON.stringify({ type, ...data }) + "\n");

  try {
    const { report, id, token: tokenValue, cached } = await freeScan(target, body.lei, emit);
    emit("done", { id, token: tokenValue, report });
    // The visitor already has the report; the owner hears about new scans only.
    if (!cached) await alertScan(report, { id, token: tokenValue, source: "website" });
  } catch (e) {
    emit("error", { error: e.code === "EBLOCKED" ? e.message : `The scan failed: ${e.message}` });
  }
  res.end();
}
