// POST /api/scan {url | lei}  -> NDJSON stream of progress events, then the
//                               sealed report (and its private link when stored)
// GET  /api/scan?id=..&t=..     -> a stored report, for its private link
import { cors, send, jsonBody, ipHash, rateLimit } from "../lib/http.js";
import { scan, normalizeInput, firmFor } from "../lib/scanner.js";
import { review, blocked, configured as aiConfigured } from "../lib/review.js";
import * as db from "../lib/db.js";
import { seal, saveScan, getScan, recentScan, aiReviewedToday } from "../lib/store.js";
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
    const host = target.hostname.replace(/^www\./, "");
    // The firm is decided by the website; an LEI only counts when the register
    // lists this site for that firm.
    const firm = firmFor(target, body.lei);
    const lei = firm ? firm.lei : null;
    if (db.enabled) {
      const cached = await recentScan(host, 10, "free", lei);
      if (cached) {
        emit("step", { msg: "This site was scanned in the last 10 minutes: showing that scan." });
        emit("done", { id: cached.id, token: cached.token, report: cached.report });
        return res.end();
      }
    }

    const { report, material, pages } = await scan({ input: target.href, lei }, emit);
    let ai = null;
    if (!aiConfigured) {
      ai = { skipped: "AI review is not configured yet" };
    } else if (material && !report.unreadable && report.firm) {
      const earlier = db.enabled ? await aiReviewedToday(host, lei) : null;
      if (earlier) {
        ai = { ...earlier, reused: true };
      } else {
        const reason = await blocked("free").catch(() => "AI review is unavailable");
        if (reason) ai = { skipped: reason };
        // One free review per site per 10 minutes, and a ceiling per hour for
        // everyone together, on top of the spend reservation in review().
        else if (!(await rateLimit("ai-site:" + host, 1, 600))) ai = { skipped: "a review of this site is already running; reload in a minute" };
        else if (!(await rateLimit("ai-free:all", 15, 3600))) ai = { skipped: "the free AI reviews for this hour are used up" };
        else {
          emit("step", { msg: "Claude is reading the disclosure pages against MiCA. This takes up to a minute." });
          const beat = setInterval(() => emit("beat"), 8000);
          try {
            ai = await review(report, material, "free");
          } finally {
            clearInterval(beat);
          }
        }
      }
    } else if (material && !report.firm) {
      ai = { skipped: "the free AI review covers firms in ESMA's MiCA register" };
    }
    if (ai) {
      report.ai = ai;
      emit("ai", { ai });
    }

    const sealed = seal(report, "free");
    let tokenValue = null;
    if (db.enabled) {
      try {
        tokenValue = await saveScan(sealed, pages);
      } catch {
        emit("step", { msg: "The report could not be saved, so it has no private link this time." });
      }
    }
    emit("done", { id: tokenValue ? sealed.id : null, token: tokenValue, report: sealed });
  } catch (e) {
    emit("error", { error: e.code === "EBLOCKED" ? e.message : `The scan failed: ${e.message}` });
  }
  res.end();
}
