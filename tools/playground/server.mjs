// PaperTrail dev playground server (issue #34). Dev tool only: no build step, no dependencies.
// Serves the playground on PT_PLAYGROUND_PORT (default 4000) and proxies /api/* to the Next dev server at
// PT_API_BASE (default http://localhost:3000). Start Next first with `npm run dev`, then `npm run playground`.
import http from "node:http";
import https from "node:https";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PT_PLAYGROUND_PORT || 4000);
const API_BASE = new URL(process.env.PT_API_BASE || "http://localhost:3000");
const API_TRANSPORT = API_BASE.protocol === "https:" ? https : http;
const ROOT = dirname(fileURLToPath(import.meta.url));
const EDGE_CASE_DIR = join(ROOT, "edge-cases");

const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
};

// Hop-by-hop headers are connection-specific and must not be forwarded by a proxy.
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer"]);

const NEXT_NOT_RUNNING =
  `The Next dev server is not reachable at ${API_BASE.origin}. ` +
  "Start it in another terminal with `npm run dev` (or set PT_API_BASE), then retry.";

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function forwardHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && value !== undefined) out[name] = value;
  }
  return out;
}

/** Streams the request (JSON or multipart) to the Next server and the response back, headers included. */
function proxyApi(req, res) {
  const headers = forwardHeaders(req.headers);
  headers.host = API_BASE.host;
  // The browser's Origin is the playground (localhost:4000); same-origin checks in Next (e.g. POST /api/delete-all)
  // compare it with their own origin, so present the request as coming from the Next origin.
  if (headers.origin) headers.origin = API_BASE.origin;
  const upstream = API_TRANSPORT.request(
    {
      protocol: API_BASE.protocol,
      hostname: API_BASE.hostname,
      port: API_BASE.port || (API_BASE.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, forwardHeaders(upstreamRes.headers));
      upstreamRes.pipe(res);
    },
  );
  upstream.on("error", (error) => {
    console.error(`[playground] proxy ${req.method} ${req.url} failed: ${error.code ?? error.message}`);
    if (!res.headersSent) sendJson(res, 502, { error: NEXT_NOT_RUNNING });
    else res.destroy();
  });
  req.pipe(upstream);
}

async function serveEdgeCases(req, res) {
  const name = decodeURIComponent(req.url.slice("/edge-cases/".length).split("?")[0]);
  if (name === "" || name === "index.json") {
    const files = (await readdir(EDGE_CASE_DIR)).filter((file) => file.endsWith(".eml")).sort();
    return sendJson(res, 200, { files });
  }
  // Only plain file names from the edge-case folder; no path traversal.
  if (!/^[\w.-]+\.(eml|md)$/.test(name)) return sendJson(res, 404, { error: "Not found" });
  try {
    const content = await readFile(join(EDGE_CASE_DIR, name), "utf8");
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

async function serveStatic(req, res) {
  const entry = STATIC_FILES[req.url.split("?")[0]];
  if (!entry) return sendJson(res, 404, { error: "Not found" });
  const content = await readFile(join(ROOT, entry[0]));
  res.writeHead(200, { "content-type": entry[1], "cache-control": "no-store" });
  res.end(content);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api/")) return proxyApi(req, res);
  const handler = url.startsWith("/edge-cases/") ? serveEdgeCases : serveStatic;
  handler(req, res).catch((error) => {
    console.error(`[playground] ${req.method} ${url} failed:`, error);
    if (!res.headersSent) sendJson(res, 500, { error: "Playground server error" });
  });
});

/** One-off startup check so a missing `npm run dev` is obvious in the terminal. */
function checkNextServer() {
  const probe = API_TRANSPORT.get(new URL("/api/debug/status", API_BASE), (res) => {
    res.resume();
    if (res.statusCode === 200) console.log(`[playground] Next dev server OK at ${API_BASE.origin}`);
    else console.warn(`[playground] ${API_BASE.origin}/api/debug/status answered HTTP ${res.statusCode}`);
  });
  probe.on("error", () => console.warn(`[playground] WARNING: ${NEXT_NOT_RUNNING}`));
  probe.setTimeout(3000, () => probe.destroy());
}

server.on("error", (error) => {
  console.error(`[playground] could not listen on port ${PORT}: ${error.message}`);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`[playground] PaperTrail dev playground: http://localhost:${PORT}`);
  console.log(`[playground] proxying /api/* to ${API_BASE.origin}`);
  checkNextServer();
});
