"use client";

// Client data hooks for page wrappers (issue #48), ported from the retired src/components/data/hooks.ts.
// Views stay props-only: pages call these hooks and pass the data down. Ids may be raw or still percent-encoded
// (the client decodes once before encoding). Each hook returns { data, error, loading, refetch }.
// Reads go through the shared cache (cache.ts, issue #108): repeat visits render cached data at once and refresh in the
// background; mutations (useAction, or `invalidate()` at a call site) refresh what they changed.
import {
  getAccount,
  getAudit,
  getClaim,
  getFinding,
  getLedger,
  getOrder,
  getSessionStatus,
} from "@/lib/api/client";
import type {
  AccountResponse,
  ClaimResponse,
  FindingResponse,
  LedgerResponse,
  OrderResponse,
  SessionStatus,
} from "@/lib/api/types";
import type { AuditEntry } from "@/lib/types";
import { CACHE_KEYS, prefetch } from "./cache";
import type { AsyncState } from "./useAsync";
import { useCached } from "./useCached";

export function useLedger(): AsyncState<LedgerResponse> {
  return useCached(CACHE_KEYS.ledger, getLedger);
}

export function useOrder(id: string): AsyncState<OrderResponse> {
  return useCached(CACHE_KEYS.order(id), () => getOrder(id));
}

export function useFinding(id: string): AsyncState<FindingResponse> {
  return useCached(CACHE_KEYS.finding(id), () => getFinding(id));
}

/** Audit log, newest first. */
export function useAudit(): AsyncState<AuditEntry[]> {
  return useCached(CACHE_KEYS.audit, getAudit);
}

/** Stored claim draft for a finding (generated and stored on first open, like GET /api/claims/:findingId). */
export function useClaim(findingId: string): AsyncState<ClaimResponse> {
  return useCached(CACHE_KEYS.claim(findingId), () => getClaim(findingId));
}

/** Gmail connection status. `connected: false` is normal in demo mode and is not an error. */
export function useSession(): AsyncState<SessionStatus> {
  return useCached(CACHE_KEYS.session, getSessionStatus);
}

/** Gmail connection, mailbox, last sync time and counts for the current account (also works for anonymous users). */
export function useAccount(): AsyncState<AccountResponse> {
  return useCached(CACHE_KEYS.account, getAccount);
}

/** Warms the cache for a page the user is about to open (nav link hover/focus). Fresh data is left alone. */
export function prefetchLedger(): void {
  void prefetch(CACHE_KEYS.ledger, getLedger);
}

export function prefetchAudit(): void {
  void prefetch(CACHE_KEYS.audit, getAudit);
}
