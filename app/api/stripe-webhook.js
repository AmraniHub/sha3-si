// POST /api/stripe-webhook  (Stripe -> us)
// 503 when no secret is configured, 400 on a bad signature, 200 once handled.
// Each event is recorded first so a redelivery is a no-op, and every object is
// re-read from the API before an order changes state.
import { rawBody, send } from "../lib/http.js";
import * as db from "../lib/db.js";
import { stripe, verifySignature, webhookSecret } from "../lib/stripe.js";
import { alert } from "../lib/alert.js";

const now = () => new Date().toISOString();

async function orderBySubscription(subId) {
  return db.one("SELECT * FROM orders WHERE stripe_subscription = ?", [subId]);
}

async function onCheckout(session) {
  const s = await stripe("GET", `/checkout/sessions/${session.id}`);
  const orderId = s.client_reference_id || (s.metadata && s.metadata.order_id);
  if (!orderId) return;
  const paid = s.payment_status === "paid" || s.payment_status === "no_payment_required";
  const status = s.mode === "subscription" ? (paid ? "active" : "pending") : paid ? "paid" : "pending";
  await db.run(
    `UPDATE orders SET status = ?, updated_at = ?, email = COALESCE(?, email), stripe_customer = ?, stripe_subscription = ?,
       amount = COALESCE(?, amount), currency = COALESCE(?, currency) WHERE id = ? AND status NOT IN ('active', 'paid', 'canceled')`,
    [status, now(), s.customer_details && s.customer_details.email, s.customer || null, s.subscription || null,
      s.amount_total, s.currency, orderId],
  );
  if (paid) {
    const o = await db.one("SELECT plan, host, email FROM orders WHERE id = ?", [orderId]);
    await alert(`paid: ${o ? o.plan : s.mode}`, [o && o.host, o && o.email, `${(s.amount_total / 100).toFixed(2)} ${String(s.currency).toUpperCase()}`, `order ${orderId}`].filter(Boolean));
  }
}

async function onSubscription(sub) {
  const s = await stripe("GET", `/subscriptions/${sub.id}`);
  const order = await orderBySubscription(s.id);
  if (!order) return;
  const status = s.status === "active" || s.status === "trialing" ? "active" : s.status === "canceled" ? "canceled" : s.status;
  await db.run("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", [status, now(), order.id]);
  if (status === "canceled") await alert("monitor cancelled", [order.host, order.email, `order ${order.id}`].filter(Boolean));
}

async function onInvoice(inv, failed) {
  const i = await stripe("GET", `/invoices/${inv.id}`);
  const subId = i.subscription || (i.parent && i.parent.subscription_details && i.parent.subscription_details.subscription);
  if (!subId) return;
  const order = await orderBySubscription(subId);
  if (!order) return;
  if (failed) {
    await db.run("UPDATE orders SET status = 'past_due', updated_at = ? WHERE id = ?", [now(), order.id]);
    await alert("monitor payment failed", [order.host, order.email, `order ${order.id}`].filter(Boolean));
  } else if (order.status !== "canceled") {
    await db.run("UPDATE orders SET status = 'active', updated_at = ? WHERE id = ?", [now(), order.id]);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only." });
  const secret = await webhookSecret();
  if (!secret || !db.enabled) return send(res, 503, { error: "not configured" });
  const raw = await rawBody(req, 1_000_000);
  if (!verifySignature(raw, req.headers["stripe-signature"], secret)) return send(res, 400, { error: "bad signature" });
  const event = JSON.parse(raw);
  const fresh = await db.run("INSERT OR IGNORE INTO stripe_events (id, created_at, type) VALUES (?, ?, ?)", [event.id, now(), event.type]);
  if (!fresh) return send(res, 200, { ok: true, duplicate: true });
  try {
    const obj = event.data && event.data.object;
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") await onCheckout(obj);
    else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") await onSubscription(obj);
    else if (event.type === "invoice.paid") await onInvoice(obj, false);
    else if (event.type === "invoice.payment_failed") await onInvoice(obj, true);
  } catch (e) {
    // Forget the event so Stripe's redelivery runs it again, and answer 500.
    await db.run("DELETE FROM stripe_events WHERE id = ?", [event.id]);
    return send(res, 500, { error: "handler failed" });
  }
  return send(res, 200, { ok: true });
}
