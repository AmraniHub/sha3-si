// POST /api/lead {email, name?, company?, role?, scan_id?, message?, consent}
// A compliance officer asking for the full report or a call.
import { cors, send, jsonBody, ipHash, rateLimit, isEmail } from "../lib/http.js";
import * as db from "../lib/db.js";
import { newId } from "../lib/evidence.js";
import { alert } from "../lib/alert.js";

const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n);

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "POST only." });
  let b;
  try {
    b = await jsonBody(req);
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
  if (b.website) return send(res, 200, { ok: true }); // honeypot field: bots fill it, people never see it
  const email = clean(b.email, 254).toLowerCase();
  if (!isEmail(email)) return send(res, 400, { error: "Please enter a valid work email." });
  if (!b.consent) return send(res, 400, { error: "Please agree to be contacted about this request." });
  if (!(await rateLimit("lead:" + ipHash(req), 5, 3600))) return send(res, 429, { error: "Too many requests. Please email us instead." });
  if (!db.enabled) return send(res, 503, { error: "Requests cannot be stored yet. Please email hello@sha3.si." });
  const lead = {
    id: "lead_" + newId(8), email, name: clean(b.name, 120), company: clean(b.company, 160), role: clean(b.role, 120),
    scan_id: clean(b.scan_id, 40), message: clean(b.message, 2000),
  };
  await db.run(
    "INSERT INTO leads (id, created_at, email, name, company, role, scan_id, message, consent, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
    [lead.id, new Date().toISOString(), lead.email, lead.name, lead.company, lead.role, lead.scan_id, lead.message, clean(b.source, 40) || "site"],
  );
  await alert("new lead", [`${lead.name || "(no name)"} <${lead.email}>`, lead.company, lead.role, lead.scan_id ? `scan ${lead.scan_id}` : "", lead.message].filter(Boolean));
  return send(res, 200, { ok: true });
}
