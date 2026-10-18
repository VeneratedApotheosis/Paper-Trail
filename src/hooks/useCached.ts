"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { emptyState, getState, refetch, subscribe, type CacheState } from "./cache";
import type { AsyncState } from "./useAsync";

/**
 * Like `useAsync`, but backed by the shared cache (see cache.ts): cached data is returned immediately (`loading` only
 * while nothing is cached), a stale entry refreshes in the background, and `refetch()` joins a request already running.
 */
export function useCached<T>(key: string, load: () => Promise<T>): AsyncState<T> {
  const loadRef = useRef(load);
  loadRef.current = load;

  const subscribeToKey = useCallback(
    (onChange: () => void) => subscribe(key, onChange, () => loadRef.current()),
    [key],
  );
  const state = useSyncExternalStore<CacheState<T>>(
    subscribeToKey,
    () => getState<T>(key),
    () => emptyState<T>(),
  );
  const refetchKey = useCallback(() => {
    void refetch(key);
  }, [key]);

  return { data: state.data, error: state.error, loading: state.data === null && state.error === null, refetch: refetchKey };
}
