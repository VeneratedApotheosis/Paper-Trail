// Per-visitor anonymous store scopes (#90). Edge-safe (used by src/middleware.ts): no Node imports.

/** httpOnly cookie with a random id per anonymous browser; set by src/middleware.ts on the first request. */
export const ANON_COOKIE = "papertrail_anon";
export const ANON_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const ANON_SCOPE_PREFIX = "anon:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Store scope for an anonymous cookie value; null when absent or not a v4 UUID (never trust a chosen id). */
export function anonymousScope(cookieValue: string | undefined): string | null {
  return cookieValue !== undefined && UUID.test(cookieValue) ? `${ANON_SCOPE_PREFIX}${cookieValue}` : null;
}

/** True for the shared cookie-less fallback scope ("anonymous") and every per-visitor anonymous scope. */
export function isAnonymousScope(scope: string): boolean {
  return scope === "anonymous" || scope.startsWith(ANON_SCOPE_PREFIX);
}
