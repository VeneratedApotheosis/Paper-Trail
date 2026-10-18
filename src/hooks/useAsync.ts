"use client";

import { useCallback, useEffect, useState } from "react";

/** Read hook state. `error` is a user-facing message (the API's `{ error }` text for ApiError). */
export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : GENERIC_ERROR_MESSAGE;
}

/** Runs `load` on mount and whenever `deps` change or `refetch()` is called; stale results are ignored. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (!active) return;
        setData(result);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(errorMessage(caught));
        setLoading(false);
      });
    return () => {
      active = false;
    };
    // `load` is recreated every render; `deps` + `nonce` drive refetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, refetch };
}
