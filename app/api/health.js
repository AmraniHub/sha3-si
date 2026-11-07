// GET /api/health -> what is configured, without revealing any value.
import { cors, send } from "../lib/http.js";
import * as db from "../lib/db.js";
import { configured, model } from "../lib/review.js";
import { mode } from "../lib/stripe.js";
import { registerAsOf } from "../lib/register.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  let dbOk = false;
  let lastAnchor = null;
  if (db.enabled) {
    try {
      await db.one("SELECT 1 AS ok");
      dbOk = true;
      lastAnchor = await db.one("SELECT day, status, bitcoin_block FROM anchors ORDER BY day DESC LIMIT 1");
    } catch {
      dbOk = false;
    }
  }
  return send(res, 200, {
    ok: true,
    region: process.env.VERCEL_REGION || "local",
    database: { backend: db.backend, reachable: dbOk },
    ai: { configured, model },
    payments: mode(),
    register_as_of: registerAsOf,
    last_anchor: lastAnchor,
  });
}
