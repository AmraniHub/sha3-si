// GET  /api/account?session_id=cs_...   -> after Checkout: the order, and its private link once paid
// GET  /api/account?o=ord_..&t=..       -> the client's private page: order, its scans, evidence
// GET  /api/account?o=..&t=..&pack=1    -> evidence pack (JSON): every record of the order with proofs
// POST /api/account {o, t}              -> a Stripe billing-portal link (invoices, cancel)
import { cors, send, jsonBody } from "../lib/http.js";
import * as db from "../lib/db.js";
import { stripe, portalSession, SITE, PLANS } from "../lib/stripe.js";
import { merkleProof, merkleRoot } from "../lib/evidence.js";

// Orders that were paid at least once. unpaid/incomplete/paused customers must
// still reach the billing portal to fix their card.
const PAID = new Set(["paid", "active", "past_due", "unpaid", "incomplete", "paused", "canceled", "attention"]);

function publicOrder(o) {
  return {
    id: o.id, plan: o.plan, plan_name: PLANS[o.plan] ? PLANS[o.plan].name : o.plan, status: o.status,
    host: o.host, email: o.email, created_at: o.created_at, amount: o.amount, currency: o.currency,
  };
}

// Only scans made for this order: never other people's scans of the same site.
async function scansFor(orderId) {
  return db.all(
    "SELECT id, created_at, day, kind, passed, gaps, review, applicable, record_hash FROM scans WHERE order_id = ? ORDER BY created_at DESC LIMIT 200",
    [orderId],
  );
}

async function pack(order) {
  const rows = await db.all("SELECT day, report, record_hash FROM scans WHERE order_id = ? ORDER BY created_at", [order.id]);
  const days = [...new Set(rows.map((r) => r.day))];
  const anchors = {};
  for (const day of days) {
    const a = await db.one("SELECT day, root, records, file_text, ots_b64, status, bitcoin_block FROM anchors WHERE day = ?", [day]);
    const leaves = (await db.all("SELECT record_hash FROM scans WHERE day = ?", [day])).map((x) => x.record_hash);
    anchors[day] = a && merkleRoot(leaves) === a.root ? { ...a, leaves } : null;
  }
  return {
    generated_at: new Date().toISOString(),
    order: publicOrder(order),
    how_to_verify: [
      "Each record's record_hash is SHA3-256 of the record's canonical JSON (keys sorted, no spaces) without the record_hash field.",
      "proof lists sibling hashes; combine pairwise with SHA3-256 (left||right) up to the day's root.",
      "anchor.file_text is the file timestamped in Bitcoin; anchor.ots_b64 is its OpenTimestamps proof (base64). Run: ots verify <file>.ots",
    ],
    records: rows.map((r) => {
      const a = anchors[r.day];
      return { record: JSON.parse(r.report), proof: a ? merkleProof(a.leaves, r.record_hash) : null, day: r.day };
    }),
    anchors: Object.fromEntries(Object.entries(anchors).map(([d, a]) => [d, a && { root: a.root, records: a.records, status: a.status, bitcoin_block: a.bitcoin_block, file_text: a.file_text, ots_b64: a.ots_b64 }])),
  };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!db.enabled) return send(res, 503, { error: "Accounts are not open yet." });
  if (req.method === "GET") {
    const q = new URL(req.url, "http://x").searchParams;
    const sessionId = q.get("session_id");
    if (sessionId) {
      if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return send(res, 400, { error: "Unknown checkout." });
      let s;
      try {
        s = await stripe("GET", `/checkout/sessions/${sessionId}`);
      } catch {
        return send(res, 404, { error: "Unknown checkout." });
      }
      const o = await db.one("SELECT * FROM orders WHERE id = ? AND stripe_session = ?", [s.client_reference_id, sessionId]);
      if (!o) return send(res, 404, { error: "Unknown order." });
      // The private link is handed out only once Stripe says the session is paid:
      // a session id alone (it is in the Checkout URL) must not open an account.
      const paid = s.status === "complete" && (s.payment_status === "paid" || s.payment_status === "no_payment_required");
      if (!paid) return send(res, 200, { paid: false, plan_name: publicOrder(o).plan_name });
      return send(res, 200, { order: publicOrder(o), paid: true, link: `${SITE}/account/?o=${o.id}&t=${o.token}` });
    }
    const o = await db.one("SELECT * FROM orders WHERE id = ?", [q.get("o") || ""]);
    if (!o || !q.get("t") || o.token !== q.get("t") || !PAID.has(o.status)) return send(res, 404, { error: "No account at this link." });
    if (q.get("pack")) {
      res.setHeader("content-disposition", `attachment; filename="sha3si-evidence-${o.host}-${new Date().toISOString().slice(0, 10)}.json"`);
      return send(res, 200, await pack(o));
    }
    return send(res, 200, { order: publicOrder(o), scans: await scansFor(o.id) });
  }
  if (req.method === "POST") {
    const b = await jsonBody(req).catch(() => ({}));
    const o = await db.one("SELECT * FROM orders WHERE id = ?", [String(b.o || "")]);
    if (!o || !b.t || o.token !== b.t || !PAID.has(o.status)) return send(res, 404, { error: "No account at this link." });
    if (!o.stripe_customer) return send(res, 409, { error: "Billing is not set up for this order yet." });
    try {
      const p = await portalSession(o.stripe_customer, `${SITE}/account/?o=${o.id}&t=${o.token}`);
      return send(res, 200, { url: p.url });
    } catch {
      return send(res, 502, { error: "The billing page could not be opened. Email hello@sha3.si and we will send your invoices." });
    }
  }
  return send(res, 405, { error: "GET or POST." });
}
