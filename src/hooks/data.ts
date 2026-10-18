"use client";

// Client data hooks for page wrappers (issue #48), ported from the retired src/components/data/hooks.ts.
// Views stay props-only: pages call these hooks and pass the data down. Ids may be raw or still percent-encoded
// (the client decodes once before encoding). Each hook returns { data, error, loading, refetch }.
import {
  getAudit,
  getClaim,
  getFinding,
  getLedger,
  getOrder,
  getSessionStatus,
} from "@/lib/api/client";
import type {
  ClaimResponse,
  FindingResponse,
  LedgerResponse,
  OrderResponse,
  SessionStatus,
} from "@/lib/api/types";
import type { AuditEntry } from "@/lib/types";
import { useAsync, type AsyncState } from "./useAsync";

export function useLedger(): AsyncState<LedgerResponse> {
  return useAsync(() => getLedger(), []);
}

export function useOrder(id: string): AsyncState<OrderResponse> {
  return useAsync(() => getOrder(id), [id]);
}

export function useFinding(id: string): AsyncState<FindingResponse> {
  return useAsync(() => getFinding(id), [id]);
}

/** Audit log, newest first. */
export function useAudit(): AsyncState<AuditEntry[]> {
  return useAsync(() => getAudit(), []);
}

/** Stored claim draft for a finding (generated and stored on first open, like GET /api/claims/:findingId). */
export function useClaim(findingId: string): AsyncState<ClaimResponse> {
  return useAsync(() => getClaim(findingId), [findingId]);
}

/** Gmail connection status. `connected: false` is normal in demo mode and is not an error. */
export function useSession(): AsyncState<SessionStatus> {
  return useAsync(() => getSessionStatus(), []);
}
