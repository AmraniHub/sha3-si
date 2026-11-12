// POST /api/telegram  (Telegram -> us), the customer bot's webhook.
// 503 until TELEGRAM_CUSTOMER_BOT_TOKEN is set, 401 without the secret header
// that setWebhook registered (POST /api/admin {"action":"telegram_setup"}).
// A user sends a website; the bot runs the same free scan as the website,
// under the same limits, and answers with a rich message and a buy button.
// Each update is recorded first, so Telegram's redelivery of a slow scan is a no-op.
import { createHash } from "node:crypto";
import { send, jsonBody, rateLimit } from "../lib/http.js";
import * as db from "../lib/db.js";
import { normalizeInput } from "../lib/scanner.js";
import { freeScan } from "../lib/freescan.js";
import { customerToken, secretMatches, sendRich, sendText, call, scanMessage, alertScan } from "../lib/telegram.js";

const HELP = [
  "Send me a crypto firm's website, for example coinhouse.com, and I check it against the MiCA website duties:",
  "authorisation statement, fees policy, climate disclosures, complaints procedure, white papers, risk warnings and the ESMA register entry.",
  "",
  "The scan reads the site from Frankfurt and takes about a minute. You get the result with an SHA3-256 evidence fingerprint and the sealed record.",
  "",
  "Free, up to 8 scans an hour. Automated; not legal advice. Privacy: https://sha3.si/privacy/",
].join("\n");

// The first thing in the message that looks like a website address.
export function siteIn(text) {
  for (const word of String(text || "").trim().split(/\s+/).slice(0, 20)) {
    const w = word.replace(/^[<(\["']+|[>)\]"'.,;!?]+$/g, "");
    if (/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(w)) return w;
  }
  return null;
}

// Hashed so the rate table never holds a Telegram user id.
const who = (id) => createHash("sha256").update((process.env.IP_SALT || "sha3.si") + "tg:" + id).digest("hex").slice(0, 32);

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only." });
  const tokenValue = customerToken();
  if (!tokenValue) return send(res, 503, { error: "not configured" });
  if (!secretMatches(req.headers["x-telegram-bot-api-secret-token"])) return send(res, 401, { error: "unauthorised" });
  let update;
  try {
    update = await jsonBody(req);
  } catch {
    return send(res, 200, { ok: true, ignored: "bad json" });
  }
  if (db.enabled && Number.isInteger(update.update_id)) {
    const fresh = await db.run("INSERT OR IGNORE INTO tg_updates (update_id, created_at) VALUES (?, ?)", [update.update_id, new Date().toISOString()]);
    if (!fresh) return send(res, 200, { ok: true, duplicate: true });
  }
  const msg = update.message;
  // Private chats only: in a group the bot would answer everyone's messages.
  if (!msg || !msg.chat || msg.chat.type !== "private" || typeof msg.text !== "string") return send(res, 200, { ok: true, ignored: true });
  const chat = msg.chat.id;
  const text = msg.text.trim();

  if (/^\/(start|help)\b/i.test(text)) {
    await sendText(tokenValue, chat, HELP);
    return send(res, 200, { ok: true });
  }
  if (/^\/id\b/i.test(text)) {
    // For the owner: the chat id to put in TELEGRAM_CHAT_ID.
    await sendText(tokenValue, chat, `This chat's id is ${chat}.`);
    return send(res, 200, { ok: true });
  }
  const site = siteIn(text.replace(/^\/scan(@\w+)?\s*/i, ""));
  if (!site) {
    await sendText(tokenValue, chat, "Send a website address, for example coinhouse.com.\n\n" + HELP);
    return send(res, 200, { ok: true });
  }
  let target;
  try {
    target = normalizeInput(site);
  } catch (e) {
    await sendText(tokenValue, chat, e.code === "EINPUT" ? e.message : "That does not look like a website address.");
    return send(res, 200, { ok: true });
  }
  // The same limits as the website's free scan: 8 an hour per person, 400 an hour in all.
  if (!(await rateLimit("scan:tg:" + who(msg.from ? msg.from.id : chat), 8, 3600)) || !(await rateLimit("scan:all", 400, 3600))) {
    await sendText(tokenValue, chat, `Too many scans in the last hour. Try again later, or order the full audit at https://sha3.si/#pricing.`);
    return send(res, 200, { ok: true, limited: true });
  }

  await sendText(tokenValue, chat, `Reading ${target.hostname} from Frankfurt. This takes about a minute.`);
  const typing = setInterval(() => call(tokenValue, "sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {}), 5000);
  try {
    const r = await freeScan(target, null);
    clearInterval(typing);
    const sent = await sendRich(tokenValue, chat, scanMessage(r.report, { id: r.id, token: r.token, audience: "customer" }));
    if (!r.cached) await alertScan(r.report, { id: r.id, token: r.token, source: "Telegram bot" });
    return send(res, 200, { ok: true, mode: sent.mode });
  } catch (e) {
    clearInterval(typing);
    await sendText(tokenValue, chat, e.code === "EBLOCKED" ? e.message : `The scan failed: ${e.message}`);
    return send(res, 200, { ok: true, failed: true });
  }
}
