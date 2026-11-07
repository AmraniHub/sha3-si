// Live check against the public OpenTimestamps calendars (needs the network).
// Usage: node tests/ots-live.mjs [outdir]   -> writes test.txt + test.txt.ots
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { stamp, parseOts, writeOts, summary, upgrade } from "../lib/ots.js";

const out = process.argv[2] || "./.data/ots";
mkdirSync(out, { recursive: true });
const text = "sha3.si ots self-test " + new Date().toISOString() + "\n";
const digest = createHash("sha256").update(text).digest();
let bytes;
for (let i = 0; i < 4 && !bytes; i++) {
  try {
    bytes = await stamp(digest);
  } catch (e) {
    console.log("attempt", i, e.message);
  }
}
if (!bytes) process.exit(1);
const proof = parseOts(bytes);
console.log("roundtrip identical:", writeOts(proof).equals(bytes), summary(proof));
writeFileSync(out + "/test.txt", text);
writeFileSync(out + "/test.txt.ots", bytes);
const up = await upgrade(bytes);
console.log("upgrade changed:", up.changed, "pending:", up.pending.length, "bitcoin:", up.bitcoin_blocks);
