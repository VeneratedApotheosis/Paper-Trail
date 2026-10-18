"use client";

// Mutation hooks for page wrappers (issue #48). Each wraps one @/lib/api/client call with pending/error state;
// `run` resolves to the response, or null when the call failed (the message is in `error`).
import { useCallback, useState } from "react";
import { approveClaim, loadDemo, saveClaim, setFindingStatus } from "@/lib/api/client";
import { errorMessage } from "./useAsync";

export interface ActionState<A extends unknown[], R> {
  run: (...args: A) => Promise<R | null>;
  pending: boolean;
  error: string | null;
}

export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>): ActionState<A, R> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: A): Promise<R | null> => {
      setPending(true);
      setError(null);
      try {
        return await action(...args);
      } catch (caught: unknown) {
        setError(errorMessage(caught));
        return null;
      } finally {
        setPending(false);
      }
    },
    [action],
  );

  return { run, pending, error };
}

/** POST /api/demo: loads the synthetic demo inbox; refetch reads afterwards. */
export function useLoadDemo() {
  return useAction(loadDemo);
}

/** POST /api/findings/:id/status (`resolved` | `dismissed` | `open`). */
export function useSetFindingStatus() {
  return useAction(setFindingStatus);
}

/** PUT /api/claims/:findingId: saves the user's edited subject/body/recipient. */
export function useSaveClaim() {
  return useAction(saveClaim);
}

/** POST /api/claims/:findingId/approve: records approval, returns mailtoUrl + clipboardText. Never sends email. */
export function useApproveClaim() {
  return useAction(approveClaim);
}
