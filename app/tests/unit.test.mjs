// node --test tests/unit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.LOCAL_DB = join(mkdtempSync(join(tmpdir(), "sha3si-")), "test.db");
process.env.ANTHROPIC_API_KEY = "test-key-never-used";
process.env.AI_MONTHLY_CAP_USD = "90";
process.env.AI_FREE_MONTHLY_CAP_USD = "40";
process.env.AI_FREE_DAILY_CAP_USD = "3";

const { isPublicIp, checkUrl, decompress } = await import("../lib/net.js");
const { linksOf, textOf, baseOf } = await import("../lib/html.js");
const { reserve, settle } = await import("../lib/review.js");
const { firmFor } = await import("../lib/scanner.js");
const zlib = await import("node:zlib");
const { merkleRoot, merkleProof, verifyProof, canonical, recordHash, sha3 } = await import("../lib/evidence.js");
const { verifySignature } = await import("../lib/stripe.js");
const { parseOts, writeOts, summary } = await import("../lib/ots.js");
const { siteKey, firmByHost } = await import("../lib/register.js");
const store = await import("../lib/store.js");
const db = await import("../lib/db.js");
const { rateLimit } = await import("../lib/http.js");

test("public and private addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111", "64:ff9b::808:808", "::ffff:8.8.8.8"]) assert.equal(isPublicIp(ip), true, ip);
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "64:ff9b::a9fe:a9fe", "::ffff:169.254.169.254", "224.0.0.1", "not-an-ip"]) {
    assert.equal(isPublicIp(ip), false, ip);
  }
});

test("URLs the scanner refuses", () => {
  for (const u of ["ftp://example.com/", "http://localhost/", "http://127.0.0.1/", "https://user:pw@example.com/",
    "https://example.com:8443/", "http://[::1]/", "http://intranet/", "http://printer.local/", "http://169.254.169.254/latest/"]) {
    assert.throws(() => checkUrl(new URL(u)), undefined, u);
  }
  checkUrl(new URL("https://www.bitpanda.com/en"));
});

test("links honour <base href> and decode entities", () => {
  const html = '<base href="https://x.example/en/"><a href="pricing">Fees &amp; costs</a><a href="/legal">Legal</a>';
  const links = linksOf(html, "https://x.example/");
  assert.equal(baseOf(html, "https://x.example/"), "https://x.example/en/");
  assert.equal(links[0].abs, "https://x.example/en/pricing");
  assert.equal(links[0].text, "Fees & costs");
  assert.equal(links[1].abs, "https://x.example/legal");
  assert.equal(textOf("<p>R&eacute;clamations&nbsp;:</p><script>x()</script>"), "Réclamations :");
});

test("merkle proofs verify, and tampering breaks them", () => {
  const leaves = Array.from({ length: 7 }, (_, i) => sha3("record " + i));
  const root = merkleRoot(leaves);
  for (const leaf of leaves) assert.equal(verifyProof(leaf, merkleProof(leaves, leaf), root), true);
  assert.equal(merkleRoot([...leaves].reverse()), root, "order does not matter");
  assert.equal(verifyProof(sha3("forged"), merkleProof(leaves, leaves[0]), root), false);
  assert.equal(merkleRoot([leaves[0]]), leaves[0]);
});

test("record hash is canonical and excludes itself", () => {
  const a = { b: 2, a: [1, { y: 1, x: 2 }], record_hash: "zz" };
  assert.equal(canonical({ x: 1, y: [2, 3] }), '{"x":1,"y":[2,3]}');
  assert.equal(recordHash(a), recordHash({ a: [1, { x: 2, y: 1 }], b: 2 }));
});

test("Stripe signature check", () => {
  const secret = "whsec_test";
  const body = '{"id":"evt_1"}';
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  assert.equal(verifySignature(body, `t=${t},v1=${sig}`, secret), true);
  assert.equal(verifySignature(body + " ", `t=${t},v1=${sig}`, secret), false);
  assert.equal(verifySignature(body, `t=${t - 3600},v1=${createHmac("sha256", secret).update(`${t - 3600}.${body}`).digest("hex")}`, secret), false, "too old");
  assert.equal(verifySignature(body, "t=1,v1=00", secret), false);
  assert.equal(verifySignature(body, "", secret), false);
});

test("OpenTimestamps proof round-trip", () => {
  const digest = createHash("sha256").update("hello").digest();
  const pending = (uri) => {
    const u = Buffer.from(uri);
    return { tag: "83dfe30d2ef90c8e", payload: Buffer.concat([Buffer.from([u.length]), u]) };
  };
  const child = (msg) => ({ msg, attestations: [pending("https://a.example")], ops: [] });
  const appended = Buffer.concat([digest, Buffer.from("01", "hex")]);
  const root = { msg: digest, attestations: [], ops: [{ op: { tag: 0xf0, name: "append", arg: Buffer.from("01", "hex") }, child: child(appended) }] };
  const bytes = writeOts({ digest, root });
  const parsed = parseOts(bytes);
  assert.equal(parsed.digest.equals(digest), true);
  assert.deepEqual(summary(parsed), { pending: ["https://a.example"], bitcoin_blocks: [] });
  assert.equal(writeOts(parsed).equals(bytes), true);
  assert.throws(() => parseOts(Buffer.from("not a proof")));
});

test("register lookups", () => {
  assert.equal(siteKey("www.bitpanda.com"), "bitpanda.com");
  assert.equal(siteKey("cc.com.mt"), "cc.com.mt");
  assert.equal(siteKey("a.b.example.co.uk"), "example.co.uk");
  assert.ok(firmByHost("www.bitpanda.com"));
  assert.equal(firmByHost("figma.com"), null, "a shared host never maps to a firm");
});

test("store: save and read a scan, wrong token refused", async () => {
  const sealed = store.seal({ target: { host: "www.example.eu" }, checks: [], score: { passed: 1, gaps: 0, review: 0, applicable: 1 }, evidence: [] }, "free");
  assert.equal(sealed.record_hash, recordHash(sealed));
  const t = await store.saveScan(sealed, [{ role: "homepage", sha3_256: sha3("x"), body: Buffer.from("x"), url: "https://www.example.eu/", fetched_at: sealed.scanned_at, status: 200, bytes: 1 }]);
  assert.equal((await store.getScan(sealed.id, t)).record_hash, sealed.record_hash);
  assert.equal(await store.getScan(sealed.id, "wrong"), null);
  assert.equal((await store.pageBody(sha3("x"))).body.toString(), "x");
  assert.ok(await store.recentScan("example.eu", 5));
});

test("rate limit counts within the window", async () => {
  assert.equal(db.enabled, true);
  for (let i = 0; i < 3; i++) assert.equal(await rateLimit("t:1", 3, 60), true);
  assert.equal(await rateLimit("t:1", 3, 60), false);
});

test("AI spend upsert accumulates", async () => {
  const day = new Date().toISOString().slice(0, 10);
  for (const usd of [0.1, 0.25]) {
    await db.run("INSERT INTO ai_usage (day, scope, usd, calls) VALUES (?, ?, ?, 1) ON CONFLICT(day, scope) DO UPDATE SET usd = usd + excluded.usd, calls = calls + 1", [day, "free", usd]);
  }
  const row = await db.one("SELECT usd, calls FROM ai_usage WHERE day = ? AND scope = 'free'", [day]);
  assert.equal(row.calls, 2);
  assert.ok(Math.abs(row.usd - 0.35) < 1e-9);
});

test("decompression is capped (zip bomb)", () => {
  const bomb = zlib.gzipSync(Buffer.alloc(20_000_000));
  assert.ok(bomb.length < 100_000, "20 MB of zeros compresses tiny");
  assert.throws(() => decompress(bomb, "gzip"), (e) => e.code === "E2BIG");
  assert.equal(decompress(zlib.gzipSync(Buffer.from("hello")), "gzip").toString(), "hello");
});

test("hostile HTML parses in linear time", () => {
  const t0 = Date.now();
  textOf("&lt;!--".replace("&lt;", "<").repeat(40000));
  textOf("<script".repeat(30000));
  linksOf("<a ".repeat(60000), "https://x.example/");
  linksOf('<a href="/x">'.repeat(30000), "https://x.example/");
  textOf("<" + "a".repeat(300000));
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
});

test("AI spend reservations hold the caps", async () => {
  const day = "2099-01-15";
  assert.equal(await reserve("free", 2.5, day), true);
  assert.equal(await reserve("free", 1, day), false, "daily free cap of 3");
  await settle("free", 2.5, 0.4, day);
  assert.equal(await reserve("free", 1, day), true, "settling frees the difference");
  assert.equal(await reserve("audit", 80, day), true);
  assert.equal(await reserve("audit", 20, day), false, "monthly cap of 90 across scopes");
  assert.equal(await reserve("free", 0.5, "2099-01-16"), true);
  const row = await db.one("SELECT SUM(usd) AS s FROM ai_usage WHERE day LIKE '2099-01%'");
  assert.ok(row.s <= 90, "never above the monthly cap");
});

test("an LEI only names the report for its own website", () => {
  const coinhouse = firmFor(new URL("https://www.coinhouse.com/"), null);
  assert.ok(coinhouse && /coinhouse/i.test(coinhouse.n));
  const spoof = firmFor(new URL("https://evil.example/"), coinhouse.lei);
  assert.equal(spoof, null, "a foreign site cannot borrow a firm's identity");
  const other = firmFor(new URL("https://www.bitpanda.com/"), coinhouse.lei);
  assert.ok(other && !/coinhouse/i.test(other.n), "the site's own firm wins");
});
