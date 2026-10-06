#!/usr/bin/env node
// sha3-check: hash files or text with SHA-3, SHAKE or Ethereum Keccak-256, and
// verify a published checksum. Zero network, zero install: `npx sha3-check`.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const keccak = require('../lib/sha3.min.js');

const NODE_ALGOS = {
  'sha3-224': 'sha3-224', 'sha3-256': 'sha3-256', 'sha3-384': 'sha3-384', 'sha3-512': 'sha3-512',
  'shake128': 'shake128', 'shake256': 'shake256',
};
const ALL = ['sha3-224', 'sha3-256', 'sha3-384', 'sha3-512', 'shake128', 'shake256', 'keccak-256'];

const HELP = `sha3-check: SHA-3, SHAKE and Keccak-256 checksums

Usage:
  sha3-check <file> [options]        hash a file
  sha3-check -s "text" [options]     hash a string (UTF-8)
  cat file | sha3-check - [options]  hash standard input

Options:
  -a, --algo <name>    sha3-224 | sha3-256 (default) | sha3-384 | sha3-512 |
                       shake128 | shake256 | keccak-256 | all
  -l, --length <bits>  output length for shake128/shake256 (default 256)
  -e, --expect <hash>  verify: exit 0 if the digest matches, 1 if not
      --json           print JSON
  -h, --help           show this help
  -v, --version        show the version

keccak-256 is Ethereum's hash (original Keccak padding); it differs from
sha3-256. Online calculator and docs: https://sha3.si
`;

function parse(argv) {
  const o = { algo: 'sha3-256', length: 256, expect: null, json: false, input: null, string: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`missing value for ${a}`);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '-a' || a === '--algo') o.algo = next().toLowerCase();
    else if (a === '-l' || a === '--length') o.length = parseInt(next(), 10);
    else if (a === '-e' || a === '--expect') o.expect = next();
    else if (a === '-s' || a === '--string') o.string = next();
    else if (a === '--json') o.json = true;
    else if (a.startsWith('-') && a !== '-') fail(`unknown option ${a}`);
    else o.input = a;
  }
  return o;
}

function fail(msg, code = 2) {
  process.stderr.write(`sha3-check: ${msg}\n`);
  process.exit(code);
}

function hasher(algo, length) {
  if (algo === 'keccak-256') {
    const h = keccak.keccak256.create();
    return { update: (b) => h.update(b), digest: () => h.hex() };
  }
  const name = NODE_ALGOS[algo];
  if (!name) fail(`unknown algorithm "${algo}" (try --help)`);
  const opts = name.startsWith('shake') ? { outputLength: length / 8 } : undefined;
  const h = crypto.createHash(name, opts);
  return { update: (b) => h.update(b), digest: () => h.digest('hex') };
}

function run(o, chunks) {
  const algos = o.algo === 'all' ? ALL : [o.algo];
  if (!(o.length >= 8 && o.length % 8 === 0)) fail('--length must be a multiple of 8, at least 8');
  const hs = algos.map((a) => [a, hasher(a, o.length)]);
  return { hs, feed: (b) => hs.forEach(([, h]) => h.update(b)) };
}

function finish(o, hs, label) {
  const results = hs.map(([a, h]) => ({ algo: a, digest: h.digest() }));
  let ok = null;
  let matched = null;
  if (o.expect) {
    const want = o.expect.trim().toLowerCase().replace(/^0x/, '');
    const hit = results.find((r) => r.digest === want);
    ok = Boolean(hit);
    matched = hit ? hit.algo : null;
  }
  if (o.json) {
    process.stdout.write(JSON.stringify({ input: label, results, verify: o.expect ? { ok, matched } : undefined }) + '\n');
  } else {
    for (const r of results) {
      process.stdout.write(o.algo === 'all' ? `${r.algo.padEnd(10)} ${r.digest}  ${label}\n` : `${r.digest}  ${label}\n`);
    }
    if (o.expect) process.stderr.write(ok ? `OK: matches ${matched}\n` : 'FAILED: checksum does not match\n');
  }
  if (o.expect) process.exit(ok ? 0 : 1);
}

function main() {
  const o = parse(process.argv.slice(2));
  if (o.help) { process.stdout.write(HELP); return; }
  if (o.version) { process.stdout.write(require('../package.json').version + '\n'); return; }

  if (o.string !== null) {
    const { hs, feed } = run(o);
    feed(Buffer.from(o.string, 'utf8'));
    return finish(o, hs, '-');
  }
  if (o.input === null) {
    if (process.stdin.isTTY) { process.stdout.write(HELP); process.exit(2); }
    o.input = '-';
  }
  const label = o.input;
  const stream = o.input === '-' ? process.stdin : fs.createReadStream(o.input);
  const { hs, feed } = run(o);
  stream.on('error', (e) => fail(e.code === 'ENOENT' ? `no such file: ${o.input}` : e.message));
  stream.on('data', feed);
  stream.on('end', () => finish(o, hs, label));
}

main();
