/**
 * Same-origin guard for state-changing routes (the browser app is the only caller). Behind a tunnel or reverse proxy
 * (ngrok, Render) `request.url` shows the internal address, so the browser's Origin is also accepted when it matches
 * AUTH_BASE_URL or the forwarded host.
 */
export function sameOriginAllowed(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = new Set<string>([new URL(request.url).origin]);
  const base = process.env.AUTH_BASE_URL;
  if (base) {
    try { allowed.add(new URL(base).origin); } catch { /* ignore a malformed AUTH_BASE_URL */ }
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? new URL(request.url).protocol.replace(":", "");
  if (host) allowed.add(`${proto}://${host}`);
  return allowed.has(origin);
}
