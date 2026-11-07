// Run the cron handler three times against a local database holding one paid
// audit for a site that cannot be read. Expect: attempts 1, 2, 3, then the
// order is parked as "attention" and no audit counts as delivered.
// Usage: node tests/cron-local.mjs
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.LOCAL_DB = join(mkdtempSync(join(tmpdir(), "sha3si-cron-")), "cron.db");
process.env.CRON_SECRET = "local-cron-secret";
const db = await import("../lib/db.js");
const { default: cron } = await import("../api/cron.js");

const now = new Date().toISOString();
await db.run("INSERT INTO orders (id, created_at, updated_at, plan, status, email, host, token) VALUES ('ord_t', ?, ?, 'audit', 'paid', 'a@b.example', 'unreachable-sha3si-test.invalid', 'tok')", [now, now]);

function call() {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }); },
    };
    cron({ headers: { authorization: "Bearer local-cron-secret" } }, res);
  });
}

for (let i = 1; i <= 4; i++) {
  const r = await call();
  const o = await db.one("SELECT status, attempts, note FROM orders WHERE id = 'ord_t'");
  console.log(`run ${i}: http ${r.status}, order ${o.status}, attempts ${o.attempts}, log: ${r.body.log.join(" | ")}`);
}
const delivered = await db.one("SELECT COUNT(*) AS n FROM scans WHERE order_id = 'ord_t' AND kind = 'audit' AND ai = 1");
console.log("audits counted as delivered:", delivered.n);
