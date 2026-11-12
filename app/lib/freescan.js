// The public free scan, shared by the website (/api/scan) and the Telegram bot
// (/api/telegram): the same cache, the same AI caps, the same sealing.
import { scan, firmFor } from "./scanner.js";
import { review, blocked, configured as aiConfigured } from "./review.js";
import { rateLimit } from "./http.js";
import * as db from "./db.js";
import { seal, saveScan, recentScan, aiReviewedToday } from "./store.js";

// Returns {report (sealed), id, token, cached}. `emit(type, data)` receives the
// progress events; it may be a no-op.
export async function freeScan(target, leiInput, emit = () => {}) {
  const host = target.hostname.replace(/^www\./, "");
  // The firm is decided by the website; an LEI only counts when the register
  // lists this site for that firm.
  const firm = firmFor(target, leiInput);
  const lei = firm ? firm.lei : null;
  if (db.enabled) {
    const cached = await recentScan(host, 10, "free", lei);
    if (cached) {
      emit("step", { msg: "This site was scanned in the last 10 minutes: showing that scan." });
      return { report: cached.report, id: cached.id, token: cached.token, cached: true };
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
  return { report: sealed, id: tokenValue ? sealed.id : null, token: tokenValue, cached: false };
}
