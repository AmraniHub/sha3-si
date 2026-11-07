// POST /api/checkout {plan, email?, host?, scan_id?} -> {url} of a Stripe Checkout page
import { cors, send, jsonBody, ipHash, rateLimit, isEmail } from "../lib/http.js";
import * as db from "../lib/db.js";
import { PLANS, checkoutSession, mode } from "../lib/stripe.js";
import { createOrder } from "../lib/store.js";
import { checkUrl } from "../lib/net.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "POST only." });
  let b;
  try {
    b = await jsonBody(req);
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
  const plan = String(b.plan || "");
  if (!PLANS[plan]) return send(res, 400, { error: "Unknown plan." });
  if (mode() === "off" || !db.enabled) {
    return send(res, 200, { error: "Online payment opens shortly. Leave your email and we will send the invoice link.", closed: true });
  }
  if (!(await rateLimit("checkout:" + ipHash(req), 10, 3600))) return send(res, 429, { error: "Too many attempts. Please try again later." });
  const email = isEmail(b.email) ? String(b.email).trim().toLowerCase() : null;
  if (!email) return send(res, 400, { error: "Please enter a valid work email for the invoice and the report." });
  // Every paid plan is about one website: without it there is nothing to audit.
  let host = null;
  try {
    const u = new URL(/^https?:/i.test(String(b.host || "")) ? b.host : "https://" + String(b.host || "").trim());
    checkUrl(u);
    host = u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    host = null;
  }
  if (!host) return send(res, 400, { error: "Please enter the website to audit or monitor, for example example.com." });
  const order = await createOrder({ plan, email, host, scanId: String(b.scan_id || "").slice(0, 40) || null });
  try {
    const session = await checkoutSession({ plan, orderId: order.id, email, host, scanId: b.scan_id });
    await db.run("UPDATE orders SET stripe_session = ?, amount = ?, currency = 'eur', updated_at = ? WHERE id = ?",
      [session.id, PLANS[plan].amount, new Date().toISOString(), order.id]);
    return send(res, 200, { url: session.url, test: mode() === "test" });
  } catch (e) {
    await db.run("UPDATE orders SET status = 'failed', updated_at = ? WHERE id = ?", [new Date().toISOString(), order.id]);
    return send(res, 502, { error: "The payment page could not be opened. Please try again or email hello@sha3.si.", detail: e.code || undefined });
  }
}
