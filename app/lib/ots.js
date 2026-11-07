// OpenTimestamps: prove a file existed at a time by anchoring its SHA-256 in
// the Bitcoin blockchain through the public calendar servers. Nothing is paid
// and no coins are held: the calendars aggregate digests and pay the
// transaction themselves. The proof file (.ots) is the standard format, so
// anyone can check it with the reference client (`ots verify`).
//
// Format, from python-opentimestamps: a timestamp is a tree. Each node holds
// attestations and operations; an operation (sha256, append bytes, ...) turns
// the node's message into a child node's message. A pending attestation names
// a calendar to ask later; a Bitcoin attestation names a block height.

import { createHash } from "node:crypto";

const MAGIC = Buffer.from("004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294", "hex");
const PENDING = "83dfe30d2ef90c8e";
const BITCOIN = "0588960d73d71901";
export const CALENDARS = ["https://a.pool.opentimestamps.org", "https://b.pool.opentimestamps.org", "https://a.pool.eternitywall.com"];


const UNARY = { 0x02: "sha1", 0x03: "ripemd160", 0x08: "sha256", 0x67: "keccak256", 0xf2: "reverse", 0xf3: "hexlify" };
const BINARY = { 0xf0: "append", 0xf1: "prepend" };

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  byte() {
    if (this.pos >= this.buf.length) throw new Error("ots: truncated");
    return this.buf[this.pos++];
  }
  bytes(n) {
    if (this.pos + n > this.buf.length) throw new Error("ots: truncated");
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  varuint() {
    let value = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      value += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return value;
      shift += 7;
    }
  }
  varbytes() {
    return this.bytes(this.varuint());
  }
}

function varuint(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return Buffer.from(out);
}

const varbytes = (b) => Buffer.concat([varuint(b.length), b]);

function apply(op, msg) {
  switch (op.name) {
    case "sha256": return createHash("sha256").update(msg).digest();
    case "sha1": return createHash("sha1").update(msg).digest();
    case "ripemd160": return createHash("ripemd160").update(msg).digest();
    case "keccak256": throw new Error("ots: keccak256 op not supported here");
    case "reverse": return Buffer.from(msg).reverse();
    case "hexlify": return Buffer.from(msg.toString("hex"), "ascii");
    case "append": return Buffer.concat([msg, op.arg]);
    case "prepend": return Buffer.concat([op.arg, msg]);
    default: throw new Error("ots: unknown op");
  }
}

// node = { msg, attestations: [{tag, payload}], ops: [{op, child}] }
function readNode(r, msg, depth = 0) {
  if (depth > 256) throw new Error("ots: too deep");
  const node = { msg, attestations: [], ops: [] };
  const one = (tag) => {
    if (tag === 0x00) {
      node.attestations.push({ tag: r.bytes(8).toString("hex"), payload: Buffer.from(r.varbytes()) });
      return;
    }
    let op;
    if (UNARY[tag]) op = { tag, name: UNARY[tag] };
    else if (BINARY[tag]) op = { tag, name: BINARY[tag], arg: Buffer.from(r.varbytes()) };
    else throw new Error(`ots: unknown tag 0x${tag.toString(16)}`);
    node.ops.push({ op, child: readNode(r, apply(op, msg), depth + 1) });
  };
  let tag = r.byte();
  while (tag === 0xff) {
    one(r.byte());
    tag = r.byte();
  }
  one(tag);
  return node;
}

const opKey = (op) => op.tag.toString(16).padStart(2, "0") + (op.arg ? op.arg.toString("hex") : "");
const attKey = (a) => a.tag + a.payload.toString("hex");

function writeNode(node) {
  const atts = [...node.attestations].sort((a, b) => attKey(a).localeCompare(attKey(b)));
  const ops = [...node.ops].sort((a, b) => opKey(a.op).localeCompare(opKey(b.op)));
  if (!atts.length && !ops.length) throw new Error("ots: empty node");
  const parts = [];
  const att = (a) => Buffer.concat([Buffer.from([0x00]), Buffer.from(a.tag, "hex"), varbytes(a.payload)]);
  const op = (o) => Buffer.concat([Buffer.from([o.op.tag]), o.op.arg ? varbytes(o.op.arg) : Buffer.alloc(0), writeNode(o.child)]);
  const items = [...atts.map(att), ...ops.map(op)];
  items.forEach((item, i) => parts.push(i < items.length - 1 ? Buffer.concat([Buffer.from([0xff]), item]) : item));
  return Buffer.concat(parts);
}

function merge(into, from) {
  for (const a of from.attestations) if (!into.attestations.some((x) => attKey(x) === attKey(a))) into.attestations.push(a);
  for (const o of from.ops) {
    const same = into.ops.find((x) => opKey(x.op) === opKey(o.op));
    if (same) merge(same.child, o.child);
    else into.ops.push(o);
  }
}

export function parseOts(buf) {
  const r = new Reader(buf);
  if (!r.bytes(MAGIC.length).equals(MAGIC)) throw new Error("ots: not an OpenTimestamps proof");
  if (r.varuint() !== 1) throw new Error("ots: unsupported version");
  if (r.byte() !== 0x08) throw new Error("ots: only SHA-256 file hashes are supported");
  const digest = Buffer.from(r.bytes(32));
  return { digest, root: readNode(r, digest) };
}

export function writeOts({ digest, root }) {
  return Buffer.concat([MAGIC, varuint(1), Buffer.from([0x08]), digest, writeNode(root)]);
}

function walk(node, fn) {
  fn(node);
  for (const o of node.ops) walk(o.child, fn);
}

export function summary(proof) {
  const pending = [];
  const bitcoin = [];
  walk(proof.root, (n) => {
    for (const a of n.attestations) {
      if (a.tag === PENDING) pending.push(new Reader(a.payload).varbytes().toString("utf8"));
      if (a.tag === BITCOIN) bitcoin.push(new Reader(a.payload).varuint());
    }
  });
  return { pending: [...new Set(pending)], bitcoin_blocks: [...new Set(bitcoin)].sort((a, b) => a - b) };
}

async function post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { accept: "application/vnd.opentimestamps.v1", "content-type": "application/x-www-form-urlencoded", "user-agent": "sha3.si-evidence/1.0" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`calendar ${url} answered ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// Timestamp a 32-byte SHA-256 digest on every calendar that answers.
export async function stamp(digest) {
  const root = { msg: digest, attestations: [], ops: [] };
  const results = await Promise.allSettled(CALENDARS.map((c) => post(`${c}/digest`, digest)));
  let ok = 0;
  for (const res of results) {
    if (res.status !== "fulfilled") continue;
    merge(root, readNode(new Reader(res.value), digest));
    ok++;
  }
  if (!ok) throw new Error("no OpenTimestamps calendar answered");
  return writeOts({ digest, root });
}

// Ask each pending calendar whether its Bitcoin transaction has confirmed.
export async function upgrade(otsBytes) {
  const proof = parseOts(otsBytes);
  const asks = [];
  walk(proof.root, (n) => {
    for (const a of n.attestations) {
      if (a.tag !== PENDING) continue;
      const uri = new Reader(a.payload).varbytes().toString("utf8");
      if (!/^https:\/\/[a-z0-9.-]+(\/[\w./-]*)?$/i.test(uri)) continue; // only plain https calendars
      asks.push({ node: n, uri });
    }
  });
  let changed = false;
  for (const { node, uri } of asks) {
    try {
      const r = await fetch(`${uri.replace(/\/$/, "")}/timestamp/${node.msg.toString("hex")}`, {
        headers: { accept: "application/vnd.opentimestamps.v1", "user-agent": "sha3.si-evidence/1.0" },
        signal: AbortSignal.timeout(15000),
      });
      if (r.status !== 200) continue;
      merge(node, readNode(new Reader(Buffer.from(await r.arrayBuffer())), node.msg));
      changed = true;
    } catch {
      // calendar down or not confirmed yet: try again tomorrow
    }
  }
  return { bytes: changed ? writeOts(proof) : otsBytes, changed, ...summary(changed ? proof : parseOts(otsBytes)) };
}
