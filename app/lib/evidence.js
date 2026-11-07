// Fingerprints and proofs.
//
// Every page the scanner reads is fingerprinted with SHA3-256 over the exact
// bytes received. Every scan record is fingerprinted the same way over its
// canonical JSON (keys sorted, no whitespace), so anyone holding the record
// can recompute its hash. Once a day the record hashes are folded into a
// SHA3-256 Merkle tree whose root is written into a small text file, and that
// file is timestamped in the Bitcoin blockchain through OpenTimestamps.
import { createHash, randomBytes } from "node:crypto";

export function sha3(data) {
  return createHash("sha3-256").update(data).digest("hex");
}

export function sha256Bytes(data) {
  return createHash("sha256").update(data).digest();
}

export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).filter((k) => value[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}

export function recordHash(record) {
  const { record_hash, ...rest } = record;
  return sha3(canonical(rest));
}

export function newId(bytes = 9) {
  return randomBytes(bytes).toString("base64url");
}

// Merkle tree over hex leaves (sorted, so the root does not depend on insert
// order). Odd levels carry the last node up unchanged.
function pair(a, b) {
  return sha3(Buffer.concat([Buffer.from(a, "hex"), Buffer.from(b, "hex")]));
}

export function merkleRoot(leaves) {
  let level = [...new Set(leaves)].sort();
  if (!level.length) return null;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}

export function merkleProof(leaves, leaf) {
  let level = [...new Set(leaves)].sort();
  let index = level.indexOf(leaf);
  if (index < 0) return null;
  const path = [];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i]);
    const sibling = index % 2 === 0 ? index + 1 : index - 1;
    if (sibling < level.length) path.push({ side: index % 2 === 0 ? "right" : "left", hash: level[sibling] });
    index = Math.floor(index / 2);
    level = next;
  }
  return path;
}

export function verifyProof(leaf, path, root) {
  let h = leaf;
  for (const step of path) h = step.side === "right" ? pair(h, step.hash) : pair(step.hash, h);
  return h === root;
}

// The file that gets timestamped each day. Plain text so anyone can rebuild
// it byte for byte from the published root and run `ots verify` on it.
export function anchorText(day, root, count) {
  return `sha3.si evidence root\nday: ${day}\nalgorithm: SHA3-256 Merkle tree over scan record hashes (sorted leaves)\nroot: ${root}\nrecords: ${count}\n`;
}
