// Server-only module (Node runtime): reads request cookies via next/headers and the auth DB through getSession.
// Import it only from server components / server actions, never from "use client" files or Edge middleware.
// (The `server-only` package is not installed, so this is not enforced at build time.)
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { getFindingsForOrder, getFinding, getOrder, getState, withStoreScope } from "@/lib/store";
import { ANON_COOKIE, anonymousScope } from "@/lib/store/anonymous";
import { CLAIM_NOT_FOUND_MESSAGE, openClaim, type OpenedClaim } from "./claims";
import { isValidRouteId, safeDecode } from "./ids";
import { buildLedgerResponse } from "./ledger";
import type { AuditResponse, FindingResponse, LedgerResponse, OrderResponse } from "./types";

export type { OpenedClaim };

/**
 * Data helpers for page wrappers rendered on the server (issue #48). Each returns the same shape as the matching
 * JSON route (docs/api.md) from the same account store the route handlers use:
 * - signed-in session (`getSession()` from `cookies()`, connected or not) -> that account's store, never the
 *   anonymous one;
 * - no session, or a stale / invalid / expired cookie or deleted account (`getSession()` returns null) -> that
 *   browser's anonymous demo/upload store (`papertrail_anon` cookie, #90), or the shared fallback without one.
 * Auth config or DB failures from getSession propagate (fail closed), as Chelsea's #49 contract requires.
 * Ids may be raw or still percent-encoded (Next 15 `params.id`); missing or invalid ids return null.
 */

async function inRequestScope<T>(task: () => T): Promise<T> {
  const session = await getSession();
  if (session) return withStoreScope(session.userId, task);
  const anonymous = anonymousScope((await cookies()).get(ANON_COOKIE)?.value);
  return anonymous ? withStoreScope(anonymous, task) : task();
}

function routeId(id: string): string | null {
  const decoded = safeDecode(id);
  return isValidRouteId(decoded) ? decoded : null;
}

/** GET /api/ledger. */
export function getLedgerForRequest(): Promise<LedgerResponse> {
  return inRequestScope(buildLedgerResponse);
}

/** GET /api/orders/:id; null when the order is unknown, excluded or deleted. */
export function getOrderForRequest(id: string): Promise<OrderResponse | null> {
  const orderId = routeId(id);
  return inRequestScope(() => {
    const order = orderId === null ? undefined : getOrder(orderId);
    return order ? { order, findings: getFindingsForOrder(order.id) } : null;
  });
}

/** GET /api/findings/:id; null when the finding (or its order) is unknown, excluded or deleted. */
export function getFindingForRequest(id: string): Promise<FindingResponse | null> {
  const findingId = routeId(id);
  return inRequestScope(() => {
    const finding = findingId === null ? undefined : getFinding(findingId);
    const order = finding ? getOrder(finding.orderId) : undefined;
    return finding && order ? { finding, order } : null;
  });
}

/** GET /api/audit. */
export function getAuditForRequest(): Promise<AuditResponse> {
  return inRequestScope(() => ({ entries: getState().audit }));
}

/**
 * GET /api/claims/:findingId: the stored draft, or a fresh template draft that is stored (like the route).
 * `{ ok: false, reason: "not_found" }` for unknown / excluded / deleted findings (route 404); other reasons are
 * draftClaim failures such as `unsupported_kind` for rewards_gap (route 422).
 */
export function getClaimForRequest(findingId: string): Promise<OpenedClaim> {
  const id = routeId(findingId);
  return inRequestScope<OpenedClaim>(() =>
    id === null ? { ok: false, reason: "not_found", message: CLAIM_NOT_FOUND_MESSAGE } : openClaim(id),
  );
}
