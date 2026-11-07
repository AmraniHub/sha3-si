// Small helpers shared by the API routes: CORS for the static site, JSON
// answers, raw bodies, a hashed client IP and a database-backed rate limit.
import { createHash } from "node:crypto";
import * as db from "./db.js";

const ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || "https://sha3.si,https://www.sha3.si").split(",").map((s) => s.trim()).filter(Boolean),
);
const DEV_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

export function cors(req, res) {
  const origin = req.headers.origin || "";
  if (ORIGINS.has(origin) || (process.env.VERCEL_ENV !== "production" && DEV_ORIGIN.test(origin)) || (process.env.ALLOW_DEV_ORIGIN === "1" && DEV_ORIGIN.test(origin))) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-max-age", "600");
  }
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export async function rawBody(req, limit = 200_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("request too large"), { code: "E2BIG" });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function jsonBody(req) {
  const raw = await rawBody(req);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error("invalid JSON"), { code: "EJSON" });
  }
}

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}

// Salted so the stored value cannot be reversed into an address.
export function ipHash(req) {
  return createHash("sha256").update((process.env.IP_SALT || "sha3.si") + clientIp(req)).digest("hex").slice(0, 32);
}

const memory = new Map();

// Allow `limit` hits per `windowSec` for `key`. Falls back to per-instance
// memory when there is no database (development).
export async function rateLimit(key, limit, windowSec) {
  const now = Date.now();
  if (!db.enabled) {
    const m = memory.get(key);
    if (!m || m.reset < now) {
      memory.set(key, { count: 1, reset: now + windowSec * 1000 });
      return true;
    }
    m.count++;
    return m.count <= limit;
  }
  const resetAt = new Date(now + windowSec * 1000).toISOString();
  await db.run(
    `INSERT INTO rate (key, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate.reset_at < ? THEN 1 ELSE rate.count + 1 END,
       reset_at = CASE WHEN rate.reset_at < ? THEN excluded.reset_at ELSE rate.reset_at END`,
    [key, resetAt, new Date(now).toISOString(), new Date(now).toISOString()],
  );
  const row = await db.one("SELECT count FROM rate WHERE key = ?", [key]);
  return !row || row.count <= limit;
}

export function isEmail(s) {
  return /^[^\s@<>()",;]{1,64}@[^\s@<>()",;]{1,190}\.[a-z]{2,}$/i.test(String(s || "").trim());
}
