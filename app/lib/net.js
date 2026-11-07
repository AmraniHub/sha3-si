// Fetching untrusted URLs safely from a server.
//
// The scanner fetches whatever site a visitor types in, from inside a cloud
// account, so every request goes through this one function. It resolves the
// name itself and refuses private, loopback, link-local (cloud metadata) and
// other non-public addresses, including IPv4 hidden inside IPv6 (mapped
// ::ffff:x and NAT64 64:ff9b::x). The check runs inside the socket's own DNS
// lookup, so a name that changes its answer between check and connect
// (DNS rebinding) is still refused. Redirects are followed by hand and each
// hop is checked again.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const V4_BLOCKED = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function v4int(ip) {
  return ip.split(".").reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);
}

function inCidr4(ip, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4int(ip) & mask) === (v4int(base) & mask);
}

// "::ffff:1.2.3.4" -> [0,0,0,0,0,0xffff,0x0102,0x0304]; [] when malformed.
function expand6(ip) {
  let s = ip.split("%")[0].toLowerCase();
  let tail = [];
  const embedded = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) {
    const n = v4int(embedded[2]);
    tail = [n >>> 16, n & 0xffff];
    s = embedded[1].endsWith("::") ? embedded[1] : embedded[1].slice(0, -1);
  }
  const hex = (part) => (part ? part.split(":").map((h) => parseInt(h, 16)) : []);
  if (!s.includes("::")) return [...hex(s), ...tail];
  const [head, rest] = s.split("::");
  const a = hex(head);
  const b = hex(rest);
  const fill = 8 - a.length - b.length - tail.length;
  if (fill < 0) return [];
  return [...a, ...Array(fill).fill(0), ...b, ...tail];
}

function v4from(hi, lo) {
  return [hi >>> 8, hi & 255, lo >>> 8, lo & 255].join(".");
}

export function isPublicIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) return !V4_BLOCKED.some(([base, bits]) => inCidr4(ip, base, bits));
  if (family !== 6) return false;
  const g = expand6(ip);
  if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return false;
  const zero = (from, to) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 5) && g[5] === 0xffff) return isPublicIp(v4from(g[6], g[7])); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return isPublicIp(v4from(g[6], g[7])); // NAT64
  if (zero(0, 8)) return false; // ::
  if (zero(0, 7) && g[7] === 1) return false; // ::1
  if (zero(0, 6)) return isPublicIp(v4from(g[6], g[7])); // deprecated IPv4-compatible ::a.b.c.d
  if (g[0] === 0x2002) return isPublicIp(v4from(g[1], g[2])); // 6to4 carries an IPv4 address
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x0100 && zero(1, 4)) return false; // discard-only
  return true;
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err);
    const allowed = addresses.filter((a) => isPublicIp(a.address));
    if (!allowed.length) {
      const e = new Error(`${hostname} resolves only to non-public addresses`);
      e.code = "EBLOCKED";
      return callback(e);
    }
    if (options && options.all) return callback(null, allowed);
    const pick = allowed.find((a) => a.family === 4) || allowed[0];
    return callback(null, pick.address, pick.family);
  });
}

function fail(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Decompressed output is capped: a few hundred KB of gzip can expand to
// gigabytes (a "zip bomb") and kill the function.
export const MAX_DECOMPRESSED = 8_000_000;

export function decompress(buf, encoding, limit = MAX_DECOMPRESSED) {
  const enc = String(encoding || "").toLowerCase().trim();
  const opts = { maxOutputLength: limit };
  try {
    if (enc === "gzip" || enc === "x-gzip") return zlib.gunzipSync(buf, opts);
    if (enc === "br") return zlib.brotliDecompressSync(buf, opts);
    if (enc === "deflate") {
      try {
        return zlib.inflateSync(buf, opts);
      } catch (e) {
        if (e instanceof RangeError) throw e;
        return zlib.inflateRawSync(buf, opts);
      }
    }
  } catch (e) {
    if (e instanceof RangeError) throw fail(`response expands beyond ${limit} bytes when decompressed`, "E2BIG");
    return buf; // a server that lies about its encoding: keep the bytes as sent
  }
  return buf;
}

function once(url, { method, headers, timeoutMs, maxBytes }) {
  return new Promise((resolveRaw, rejectRaw) => {
    const lib = url.protocol === "https:" ? https : http;
    const started = Date.now();
    // Wall-clock limit for the whole exchange. The socket timeout below only
    // fires when the line goes silent, so a server dripping one byte a second
    // would otherwise hold the request open indefinitely.
    let settled = false;
    const wall = setTimeout(() => req.destroy(fail(`no complete answer within ${timeoutMs} ms`, "ETIMEDOUT")), timeoutMs);
    const resolve = (v) => { if (!settled) { settled = true; clearTimeout(wall); resolveRaw(v); } };
    const reject = (e) => { if (!settled) { settled = true; clearTimeout(wall); rejectRaw(e); } };
    const req = lib.request(
      url,
      {
        method,
        lookup: safeLookup,
        headers: {
          "user-agent": BROWSER_UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-GB,en;q=0.8",
          "accept-encoding": "gzip, deflate, br",
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        let truncated = false;
        res.on("data", (c) => {
          if (truncated) return;
          size += c.length;
          if (size > maxBytes) {
            truncated = true;
            chunks.push(c.subarray(0, c.length - (size - maxBytes)));
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        const finish = () => {
          const raw = Buffer.concat(chunks);
          let body = raw;
          try {
            if (!truncated) body = decompress(raw, res.headers["content-encoding"]);
          } catch (e) {
            return reject(e);
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, body, truncated, ms: Date.now() - started });
        };
        res.on("end", finish);
        res.on("close", () => (truncated ? finish() : undefined));
        res.on("error", (e) => (truncated ? finish() : reject(e)));
      },
    );
    req.on("timeout", () => req.destroy(fail(`timed out after ${timeoutMs} ms`, "ETIMEDOUT")));
    req.on("error", reject);
    req.end();
  });
}

export function checkUrl(url) {
  if (!/^https?:$/.test(url.protocol)) throw fail("only http and https URLs can be scanned", "EPROTO");
  if (url.username || url.password) throw fail("URLs with credentials are not allowed", "ECRED");
  if (url.port && url.port !== "80" && url.port !== "443") throw fail("only ports 80 and 443 are allowed", "EPORT");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicIp(host)) throw fail("that address is not public", "EBLOCKED");
  if (!net.isIP(host) && (!host.includes(".") || /\.(local|internal|localhost|lan|home|corp)$/i.test(host)))
    throw fail("that host name is not public", "EBLOCKED");
}

// Fetch a public URL. Never throws for HTTP errors (status is in the result);
// throws for blocked targets, DNS failures and timeouts.
export async function safeFetch(input, { method = "GET", headers = {}, timeoutMs = 15000, maxBytes = 3_000_000, maxRedirects = 5 } = {}) {
  let url = new URL(input);
  const chain = [];
  // One time limit for the whole redirect chain, not one per hop.
  const until = Date.now() + timeoutMs;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    checkUrl(url);
    const left = until - Date.now();
    if (left <= 0) throw fail(`no complete answer within ${timeoutMs} ms`, "ETIMEDOUT");
    const res = await once(url, { method, headers, timeoutMs: left, maxBytes });
    chain.push({ url: url.href, status: res.status });
    const location = res.headers.location;
    if ([301, 302, 303, 307, 308].includes(res.status) && location) {
      url = new URL(location, url);
      continue;
    }
    return { ...res, url: url.href, chain };
  }
  throw fail(`more than ${maxRedirects} redirects`, "EREDIRECT");
}
