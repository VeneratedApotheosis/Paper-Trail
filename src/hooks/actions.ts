"use client";

// Mutation hooks for page wrappers (issue #48). Each wraps one @/lib/api/client call with pending/error state;
// `run` resolves to the response, or null when the call failed (the message is in `error`). A successful run invalidates
// the shared read cache (cache.ts, issue #108) and waits for the refetch, so every page and the app shell already show
// the new data when `pending` ends; the page does not need to call `refetch()` itself.
import { useCallback, useState } from "react";
import { approveClaim, loadDemo, saveClaim, setFindingStatus } from "@/lib/api/client";
import { invalidate, LEDGER_DATA_KEYS } from "./cache";
import { errorMessage } from "./useAsync";

export interface ActionState<A extends unknown[], R> {
  run: (...args: A) => Promise<R | null>;
  pending: boolean;
  error: string | null;
}

/**
 * Wraps one mutation. `invalidates` limits which cache keys are refreshed after success; the default is every key
 * (ledger, session, audit, orders, findings, claims).
 */
export function useAction<A extends unknown[], R>(
  action: (...args: A) => Promise<R>,
  invalidates?: readonly string[],
): ActionState<A, R> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: A): Promise<R | null> => {
      setPending(true);
      setError(null);
      try {
        const result = await action(...args);
        await invalidate(invalidates);
        return result;
      } catch (caught: unknown) {
        setError(errorMessage(caught));
        return null;
      } finally {
        setPending(false);
      }
    },
    [action, invalidates],
  );

  return { run, pending, error };
}

/** POST /api/demo: loads the synthetic demo inbox; refetch reads afterwards. */
export function useLoadDemo() {
  return useAction(loadDemo);
}

/** POST /api/findings/:id/status (`resolved` | `dismissed` | `open`). */
export function useSetFindingStatus() {
  return useAction(setFindingStatus, LEDGER_DATA_KEYS);
}

/** PUT /api/claims/:findingId: saves the user's edited subject/body/recipient. */
export function useSaveClaim() {
  return useAction(saveClaim, LEDGER_DATA_KEYS);
}

/** POST /api/claims/:findingId/approve: records approval, returns mailtoUrl + clipboardText. Never sends email. */
export function useApproveClaim() {
  return useAction(approveClaim, LEDGER_DATA_KEYS);
}
