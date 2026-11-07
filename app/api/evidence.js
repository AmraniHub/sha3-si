// Public evidence verification.
// GET /api/evidence?h=<record hash>        -> what was scanned, when, from where,
//                                             its Merkle proof and the day's anchor
// GET /api/evidence?day=YYYY-MM-DD&file=txt -> the anchor text file
// GET /api/evidence?day=YYYY-MM-DD&file=ots -> its OpenTimestamps proof
// Only fingerprints and check results are public; page bodies and private
// report links are not.
import { cors, send } from "../lib/http.js";
import * as db from "../lib/db.js";
import { merkleProof, merkleRoot } from "../lib/evidence.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!db.enabled) return send(res, 503, { error: "Evidence is not stored yet." });
  const q = new URL(req.url, "http://x").searchParams;
  const day = q.get("day");
  if (day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return send(res, 400, { error: "Bad day." });
    const a = await db.one("SELECT * FROM anchors WHERE day = ?", [day]);
    if (!a) return send(res, 404, { error: "No anchor for that day yet. Days are anchored after they end (UTC)." });
    const file = q.get("file");
    if (file === "txt") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="sha3si-${day}.txt"`);
      return res.end(a.file_text);
    }
    if (file === "ots") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/vnd.opentimestamps.v1");
      res.setHeader("content-disposition", `attachment; filename="sha3si-${day}.txt.ots"`);
      return res.end(Buffer.from(a.ots_b64, "base64"));
    }
    return send(res, 200, { day, root: a.root, records: a.records, status: a.status, bitcoin_block: a.bitcoin_block, file_text: a.file_text });
  }
  const h = String(q.get("h") || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) return send(res, 400, { error: "Give a 64-character SHA3-256 record hash." });
  const row = await db.one("SELECT day, report FROM scans WHERE record_hash = ?", [h]);
  if (!row) return send(res, 404, { error: "No scan record with that fingerprint." });
  const r = JSON.parse(row.report);
  const leaves = (await db.all("SELECT record_hash FROM scans WHERE day = ?", [row.day])).map((x) => x.record_hash);
  const anchor = await db.one("SELECT root, records, status, bitcoin_block FROM anchors WHERE day = ?", [row.day]);
  const proof = anchor && merkleRoot(leaves) === anchor.root ? merkleProof(leaves, h) : null;
  return send(res, 200, {
    record_hash: h,
    scanned_at: r.scanned_at,
    scanned_from: r.scanned_from,
    host: r.target.host,
    firm: r.firm ? { name: r.firm.name, lei: r.firm.lei, authority: r.firm.authority } : null,
    kind: r.kind,
    score: r.score,
    checks: (r.checks || []).map((c) => ({ id: c.id, title: c.title, state: c.state, label: c.label, ref: c.ref, page: c.page })),
    pages: (r.evidence || []).map((e) => ({ role: e.role, url: e.final_url || e.url, status: e.status, fetched_at: e.fetched_at, bytes: e.bytes, sha3_256: e.sha3_256 })),
    day: row.day,
    anchor: anchor ? { ...anchor, proof } : null,
  });
}
