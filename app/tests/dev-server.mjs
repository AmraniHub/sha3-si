// Local stand-in for Vercel: serves ../docs and routes /api/<name> to api/<name>.js.
// Usage: LOCAL_DB=.data/dev.db node tests/dev-server.mjs   -> http://127.0.0.1:8792
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const DOCS = normalize(join(here, "..", "..", "docs"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml", ".webmanifest": "application/manifest+json" };
const handlers = {};

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const api = url.pathname.match(/^\/api\/([a-z-]+)$/);
  if (api) {
    try {
      handlers[api[1]] ||= (await import(`../api/${api[1]}.js`)).default;
      return await handlers[api[1]](req, res);
    } catch (e) {
      console.error(e);
      res.statusCode = 500;
      return res.end(String(e.message));
    }
  }
  let file = normalize(join(DOCS, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DOCS)) {
    res.statusCode = 403;
    return res.end();
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    res.setHeader("content-type", TYPES[extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end(await readFile(join(DOCS, "404.html")).catch(() => "not found"));
  }
}).listen(8792, "127.0.0.1", () => console.log("dev server on http://127.0.0.1:8792"));
