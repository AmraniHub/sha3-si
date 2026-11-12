// Storage. Production: Turso (hosted libSQL) over its HTTP pipeline API, so no
// native driver ships in the function. Local dev: Node's built-in SQLite file
// (LOCAL_DB=path). With neither configured the app still scans, but nothing
// persists, so private report links and the paid flows are switched off.
//
// Vercel functions have no persistent disk: a file database there is wiped on
// every cold start, which is why production must use Turso.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS scans (
     id TEXT PRIMARY KEY, token TEXT NOT NULL, created_at TEXT NOT NULL, day TEXT NOT NULL,
     host TEXT NOT NULL, lei TEXT, firm TEXT, kind TEXT NOT NULL, order_id TEXT, ai INTEGER NOT NULL DEFAULT 0,
     passed INTEGER, gaps INTEGER, review INTEGER, applicable INTEGER,
     report TEXT NOT NULL, record_hash TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS scans_host ON scans(host, created_at)`,
  `CREATE INDEX IF NOT EXISTS scans_order ON scans(order_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS scans_day ON scans(day)`,
  `CREATE INDEX IF NOT EXISTS scans_hash ON scans(record_hash)`,
  `CREATE TABLE IF NOT EXISTS pages (
     sha3_256 TEXT PRIMARY KEY, url TEXT NOT NULL, fetched_at TEXT NOT NULL, status INTEGER,
     content_type TEXT, bytes INTEGER, body_gz TEXT)`,
  `CREATE TABLE IF NOT EXISTS leads (
     id TEXT PRIMARY KEY, created_at TEXT NOT NULL, email TEXT NOT NULL, name TEXT, company TEXT,
     role TEXT, scan_id TEXT, message TEXT, consent INTEGER NOT NULL DEFAULT 0, source TEXT)`,
  `CREATE TABLE IF NOT EXISTS orders (
     id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, plan TEXT NOT NULL,
     status TEXT NOT NULL, email TEXT, host TEXT, scan_id TEXT, stripe_session TEXT,
     stripe_customer TEXT, stripe_subscription TEXT, amount INTEGER, currency TEXT, token TEXT,
     attempts INTEGER NOT NULL DEFAULT 0, note TEXT)`,
  `CREATE INDEX IF NOT EXISTS orders_sub ON orders(stripe_subscription)`,
  `CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, type TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS anchors (
     day TEXT PRIMARY KEY, root TEXT NOT NULL, records INTEGER NOT NULL, file_text TEXT NOT NULL,
     ots_b64 TEXT, status TEXT NOT NULL, bitcoin_block INTEGER, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ai_usage (
     day TEXT NOT NULL, scope TEXT NOT NULL, usd REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (day, scope))`,
  `CREATE TABLE IF NOT EXISTS rate (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tg_updates (update_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL)`,
];

// Columns added after the first schema. Each runs once per instance; "duplicate
// column" errors are expected on databases that already have them.
const MIGRATIONS = [
  "ALTER TABLE scans ADD COLUMN order_id TEXT",
  "ALTER TABLE scans ADD COLUMN ai INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE orders ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE orders ADD COLUMN note TEXT",
];

function tursoUrl() {
  const raw = process.env.TURSO_DATABASE_URL || "";
  return raw ? raw.replace(/^libsql:\/\//, "https://").replace(/\/$/, "") : "";
}

function toArg(v) {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "number") return Number.isInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v };
  if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
  return { type: "text", value: String(v) };
}

function fromValue(v) {
  if (!v || v.type === "null") return null;
  if (v.type === "integer") return Number(v.value);
  if (v.type === "float") return Number(v.value);
  if (v.type === "blob") return Buffer.from(v.base64, "base64");
  return v.value;
}

async function tursoPipeline(statements) {
  const url = tursoUrl();
  const requests = statements.map(([sql, args = []]) => ({ type: "execute", stmt: { sql, args: args.map(toArg) } }));
  requests.push({ type: "close" });
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url + "/v2/pipeline", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.TURSO_AUTH_TOKEN || ""}`, "content-type": "application/json" },
        body: JSON.stringify({ requests }),
      });
      if (!r.ok) throw new Error(`Turso HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      return j.results.slice(0, statements.length).map((res) => {
        if (res.type === "error") throw new Error(`Turso: ${res.error && res.error.message}`);
        const result = res.response.result;
        const cols = result.cols.map((c) => c.name);
        return { rows: result.rows.map((row) => Object.fromEntries(row.map((v, i) => [cols[i], fromValue(v)]))), changes: result.affected_row_count };
      });
    } catch (e) {
      lastError = e;
      if (String(e.message).startsWith("Turso:")) throw e; // SQL error: retrying cannot help
      await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

let local = null;
async function localDb() {
  if (!local) {
    const { DatabaseSync } = await import("node:sqlite");
    local = new DatabaseSync(process.env.LOCAL_DB);
  }
  return local;
}

async function localPipeline(statements) {
  const db = await localDb();
  return statements.map(([sql, args = []]) => {
    const stmt = db.prepare(sql);
    const vals = args.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v));
    if (/^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql)) return { rows: stmt.all(...vals), changes: 0 };
    const info = stmt.run(...vals);
    return { rows: [], changes: Number(info.changes) };
  });
}

export const enabled = Boolean(tursoUrl() && process.env.TURSO_AUTH_TOKEN) || Boolean(process.env.LOCAL_DB);
export const backend = tursoUrl() ? "turso" : process.env.LOCAL_DB ? "sqlite-file" : "none";

let ready = null;
async function pipeline(statements) {
  if (!enabled) throw Object.assign(new Error("no database configured"), { code: "ENODB" });
  if (!ready) {
    const run = backend === "turso" ? tursoPipeline : localPipeline;
    ready = (async () => {
      await run(SCHEMA.map((s) => [s]));
      for (const m of MIGRATIONS) {
        try {
          await run([[m]]);
        } catch (e) {
          if (!/duplicate column/i.test(String(e.message))) throw e;
        }
      }
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  await ready;
  return backend === "turso" ? tursoPipeline(statements) : localPipeline(statements);
}

export async function all(sql, args = []) {
  return (await pipeline([[sql, args]]))[0].rows;
}

export async function one(sql, args = []) {
  return (await all(sql, args))[0] || null;
}

export async function run(sql, args = []) {
  return (await pipeline([[sql, args]]))[0].changes;
}

export async function batch(statements) {
  return pipeline(statements);
}
