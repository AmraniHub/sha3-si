// Stripe over its REST API (form-encoded), no SDK. Pattern from the House's
// Stripe playbook (Latitax/Heberlis): inline price_data, B2B reverse charge
// (VAT ID collection, required billing address, an invoice for one-off
// payments), API version pinned to the one the webhook endpoint is created
// with, and every webhook object re-read from the API before acting on it.
import { createHmac, timingSafeEqual } from "node:crypto";
import * as db from "./db.js";

export const API_VERSION = "2024-06-20";
export const SITE = process.env.SITE_URL || "https://sha3.si";

export const PLANS = {
  audit: { name: "MiCA website audit", amount: 149000, mode: "payment",
    description: "EU scan, Claude review and a written report checked by a person, with evidence fingerprints. Delivered within 48 hours." },
  monitor_month: { name: "MiCA website monitor (monthly)", amount: 29000, mode: "subscription", interval: "month",
    description: "Weekly scan from Frankfurt, email when something changes, tamper-evident evidence log, downloadable evidence pack." },
  monitor_year: { name: "MiCA website monitor (annual, audit included)", amount: 290000, mode: "subscription", interval: "year",
    description: "Everything in the monthly monitor for 12 months, two months free, and the full audit included." },
};

export const WEBHOOK_EVENTS = [
  "checkout.session.completed", "checkout.session.async_payment_succeeded",
  "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed",
];

export function key() {
  return process.env.STRIPE_SECRET_KEY || "";
}

export function mode() {
  const k = key();
  return k.startsWith("sk_live_") || k.startsWith("rk_live_") ? "live" : k ? "test" : "off";
}

function form(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) form(v, name, out);
    else if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? form(item, `${name}[${i}]`, out) : out.push([`${name}[${i}]`, String(item)])));
    else out.push([name, String(v)]);
  }
  return out;
}

export async function stripe(method, path, params) {
  if (!key()) throw Object.assign(new Error("Stripe is not configured"), { code: "ENOSTRIPE" });
  const body = params ? new URLSearchParams(form(params)).toString() : undefined;
  const url = `https://api.stripe.com/v1${path}${method === "GET" && body ? "?" + body : ""}`;
  const r = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${key()}`,
      "stripe-version": API_VERSION,
      ...(method !== "GET" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method !== "GET" ? body : undefined,
  });
  const j = await r.json();
  if (!r.ok) {
    const e = new Error(j.error?.message || `Stripe HTTP ${r.status}`);
    e.code = j.error?.code || "ESTRIPE";
    e.status = r.status;
    throw e;
  }
  return j;
}

export async function checkoutSession({ plan, orderId, email, host, scanId }) {
  const p = PLANS[plan];
  const meta = { order_id: orderId, plan, host: host || "", scan_id: scanId || "" };
  const params = {
    mode: p.mode,
    client_reference_id: orderId,
    success_url: `${SITE}/account/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/#pricing`,
    locale: "auto",
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    customer_email: email || undefined,
    metadata: meta,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: p.amount,
        product_data: { name: p.name, description: host ? `${p.description} Website: ${host}.` : p.description },
        ...(p.interval ? { recurring: { interval: p.interval } } : {}),
      },
    }],
    custom_text: { submit: { message: "Billed by Servolia LLC (Wyoming, USA). EU business customers: VAT reverse charge applies; add your VAT number above." } },
  };
  if (p.mode === "payment") {
    params.invoice_creation = { enabled: true, invoice_data: { metadata: meta } };
    params.payment_intent_data = { metadata: meta };
  } else {
    params.subscription_data = { metadata: meta };
  }
  if (process.env.STRIPE_TERMS === "1") params.consent_collection = { terms_of_service: "required" };
  return stripe("POST", "/checkout/sessions", params);
}

export async function portalSession(customer, returnUrl) {
  return stripe("POST", "/billing_portal/sessions", { customer, return_url: returnUrl });
}

// The webhook secret lives in the env, or in the database when the endpoint
// was created by the admin "connect" action (so it never passes through chat).
export async function webhookSecret() {
  if (process.env.STRIPE_WEBHOOK_SECRET) return process.env.STRIPE_WEBHOOK_SECRET;
  if (!db.enabled) return "";
  const row = await db.one("SELECT value FROM settings WHERE key = ?", ["stripe_webhook_secret_" + mode()]).catch(() => null);
  return row ? row.value : "";
}

export function verifySignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(String(header).split(",").map((kv) => kv.split("=")).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const sigs = String(header).split(",").filter((kv) => kv.trim().startsWith("v1=")).map((kv) => kv.trim().slice(3));
  return sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
