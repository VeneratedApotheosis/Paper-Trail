#!/usr/bin/env node
// One-command local demo (issue #41): starts (or reuses) the Next dev server, starts the dev playground (#34)
// on a free port, preloads the synthetic seed demo, and opens the browser.
//
//   npm run demo                 # default
//   npm run demo -- --no-open    # don't open a browser
//   PT_API_PORT=3001 npm run demo
//
// Node built-ins only. Ctrl+C stops everything this script started.
import { spawn, execFile } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = Number(process.env.PT_API_PORT || 3000);
const API_BASE = `http://localhost:${API_PORT}`;
const OPEN_BROWSER = !process.argv.includes("--no-open");
const isWindows = process.platform === "win32";
const children = [];

const log = (msg) => console.log(`[demo] ${msg}`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when the port is free to listen on. */
function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port);
  });
}

async function findFreePort(start) {
  for (let port = start; port < start + 50; port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error(`no free port found in ${start}-${start + 49}`);
}

/** Is a PaperTrail API answering on API_BASE? (Checks a PaperTrail-specific route, not just "something listens".) */
async function paperTrailApiUp() {
  try {
    const res = await fetch(`${API_BASE}/api/prefilter`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return false;
    const body = await res.json();
    return typeof body.query === "string";
  } catch {
    return false;
  }
}

function start(label, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows, // npx is a .cmd shim on Windows
  });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => console.log(`[${label}] ${line}`));
  child.stdout.on("data", prefix);
  child.stderr.on("data", prefix);
  child.on("exit", (code) => {
    if (!shuttingDown) log(`${label} exited (code ${code}). Stopping.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (isWindows) execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => {});
    else child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => {
  log("stopping...");
  shutdown(0);
});
process.on("SIGTERM", () => shutdown(0));

function openBrowser(url) {
  const [cmd, args] = isWindows
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  execFile(cmd, args, () => {});
}

async function main() {
  // 1. Next dev server: reuse if PaperTrail is already up, refuse if the port is taken by something else.
  if (await paperTrailApiUp()) {
    log(`reusing the PaperTrail dev server already running at ${API_BASE}`);
  } else if (!(await portIsFree(API_PORT))) {
    console.error(
      `[demo] port ${API_PORT} is in use by something that isn't the PaperTrail API. ` +
        `Stop it, or run with PT_API_PORT=<free port>.`,
    );
    process.exit(1);
  } else {
    log(`starting Next dev server on ${API_BASE} (first start can take ~30s)...`);
    start("next", "npx", ["next", "dev", "-p", String(API_PORT)]);
    const deadline = Date.now() + 180_000;
    while (!(await paperTrailApiUp())) {
      if (shuttingDown) return;
      if (Date.now() > deadline) {
        console.error("[demo] Next dev server did not become ready within 3 minutes.");
        shutdown(1);
        return;
      }
      await sleep(1500);
    }
    log("Next dev server is ready");
  }

  // 2. Playground on a free port.
  const playgroundPort = await findFreePort(Number(process.env.PT_PLAYGROUND_PORT || 4000));
  const playgroundUrl = `http://localhost:${playgroundPort}`;
  start("playground", process.execPath, [path.join("tools", "playground", "server.mjs")], {
    PT_PLAYGROUND_PORT: String(playgroundPort),
    PT_API_BASE: API_BASE,
  });
  for (let i = 0; i < 40; i += 1) {
    try {
      if ((await fetch(playgroundUrl, { signal: AbortSignal.timeout(2000) })).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }

  // 3. Preload the synthetic demo so the Ledger tab has data immediately.
  try {
    const res = await fetch(`${API_BASE}/api/demo`, { method: "POST", signal: AbortSignal.timeout(120_000) });
    const body = await res.json();
    if (res.ok) {
      log(
        `demo loaded: ${body.stats?.emails ?? "?"} synthetic emails -> ${body.summary?.findingCount ?? "?"} findings, ` +
          `owed ${body.summary?.currency ?? ""} ${Number(body.summary?.owedTotal ?? 0).toFixed(2)}`,
      );
    } else {
      log(`could not preload demo (${res.status}): ${body.error ?? "unknown error"}. Use "Load demo" in the Ledger tab.`);
    }
  } catch (err) {
    log(`could not preload demo: ${err.message}. Use "Load demo" in the Ledger tab.`);
  }

  console.log("");
  log(`Playground:        ${playgroundUrl}`);
  log(`Raw ledger JSON:   ${API_BASE}/api/ledger`);
  log(`Test checklist:    docs/manual-test-plan.md`);
  log(`Edge-case emails:  tools/playground/edge-cases/ (pick them in the Email lab tab)`);
  log("All demo data is synthetic. Live Claude extraction is opt-in in the Email lab (needs ANTHROPIC_API_KEY).");
  log("Press Ctrl+C to stop.");
  if (OPEN_BROWSER) openBrowser(playgroundUrl);
}

main().catch((err) => {
  console.error(`[demo] ${err.stack ?? err}`);
  shutdown(1);
});
