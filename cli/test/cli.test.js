'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const BIN = path.join(__dirname, '..', 'bin', 'sha3-check.js');
const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], { input, encoding: 'utf8' });

test('string SHA3-256 matches the FIPS 202 known answer', () => {
  const r = run(['-s', 'abc']);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.split(' ')[0], '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532');
});

test('keccak-256 gives the Ethereum ERC-20 transfer selector', () => {
  const r = run(['-s', 'transfer(address,uint256)', '-a', 'keccak-256']);
  assert.ok(r.stdout.startsWith('a9059cbb'), r.stdout);
});

test('keccak-256 of empty string', () => {
  const r = run(['-s', '', '-a', 'keccak-256']);
  assert.ok(r.stdout.startsWith('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'));
});

test('file hashing streams and matches node crypto, for every algorithm', () => {
  const f = path.join(os.tmpdir(), `sha3-check-${process.pid}.bin`);
  const data = crypto.randomBytes(3 * 1024 * 1024 + 7);
  fs.writeFileSync(f, data);
  try {
    for (const a of ['sha3-224', 'sha3-256', 'sha3-384', 'sha3-512']) {
      const want = crypto.createHash(a).update(data).digest('hex');
      assert.strictEqual(run([f, '-a', a]).stdout.split(' ')[0], want, a);
    }
    const shake = crypto.createHash('shake256', { outputLength: 64 }).update(data).digest('hex');
    assert.strictEqual(run([f, '-a', 'shake256', '-l', '512']).stdout.split(' ')[0], shake);
  } finally {
    fs.unlinkSync(f);
  }
});

test('stdin input', () => {
  const r = run(['-'], 'hello world');
  assert.strictEqual(r.stdout.split(' ')[0], crypto.createHash('sha3-256').update('hello world').digest('hex'));
});

test('--expect: exit 0 on match (case-insensitive, 0x allowed), 1 on mismatch', () => {
  const good = '0x' + crypto.createHash('sha3-512').update('x').digest('hex').toUpperCase();
  assert.strictEqual(run(['-s', 'x', '-a', 'sha3-512', '-e', good]).status, 0);
  assert.strictEqual(run(['-s', 'x', '-e', 'deadbeef']).status, 1);
});

test('-a all with --expect finds which algorithm matched', () => {
  const k = run(['-s', 'abc', '-a', 'keccak-256']).stdout.split(' ')[0];
  const r = run(['-s', 'abc', '-a', 'all', '-e', k, '--json']);
  assert.strictEqual(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.verify.matched, 'keccak-256');
  assert.strictEqual(j.results.length, 7);
});

test('errors: unknown algorithm and missing file exit 2 with a message', () => {
  const a = run(['-s', 'x', '-a', 'md5']);
  assert.strictEqual(a.status, 2);
  assert.match(a.stderr, /unknown algorithm/);
  const b = run(['no-such-file.bin']);
  assert.strictEqual(b.status, 2);
  assert.match(b.stderr, /no such file/);
});
