// Shared client read cache (issue #108): one module-level store keyed by endpoint, used by the data hooks and the app
// shell so navigating between pages shows cached data immediately instead of a skeleton plus a refetch.
//
// - Stale-while-revalidate: `subscribe` (a hook mounting) serves what is cached and refreshes in the background only
//   when the data is older than STALE_MS. `loading` in the hooks means "nothing cached yet".
// - In-flight requests are deduplicated per key, so a page and the shell asking for the same endpoint make one request.
// - `invalidate(keys?)` is called after every mutation. Keys with a mounted hook are refetched right away (the old data
//   stays on screen until the fresh data lands); keys nobody is looking at are dropped so the next visit never shows
//   data from before the mutation. A request that was already running when a key was invalidated is ignored.
// - A background refresh that fails keeps the cached data and says nothing; a failure with nothing cached, or after
//   an explicit refetch/invalidate, is reported through `error`.
//
// No React in this file: src/hooks/useCached.ts binds it to components. Keys are plain strings; an id-scoped key is
// `"<kind>:<id>"` and `invalidate(["order"])` matches every `order:*` key.
import { errorMessage } from "./useAsync";

export interface CacheState<T> {
  readonly data: T | null;
  readonly error: string | null;
  /** `Date.now()` of the last successful load; 0 when nothing is cached. */
  readonly fetchedAt: number;
}

/** Cached data older than this is refreshed in the background when a page that uses it mounts. */
export const STALE_MS = 5_000;

export const CACHE_KEYS = {
  ledger: "ledger",
  session: "session",
  /** GET /api/account: Gmail connection, mailbox, last sync time, counts (issue #110). */
  account: "account",
  audit: "audit",
  order: (id: string) => `order:${id}`,
  finding: (id: string) => `finding:${id}`,
  claim: (id: string) => `claim:${id}`,
} as const;

/** What a mutation that touches ledger data (not the Gmail session) must invalidate. */
export const LEDGER_DATA_KEYS = ["ledger", "order", "finding", "claim", "audit"] as const;

type Loader = () => Promise<unknown>;

interface Entry {
  state: CacheState<unknown>;
  loader: Loader | null;
  inflight: Promise<void> | null;
  /** Bumped by invalidate(); a response from an older generation is dropped. */
  generation: number;
  listeners: Set<() => void>;
}

const EMPTY_STATE: CacheState<never> = { data: null, error: null, fetchedAt: 0 };
const entries = new Map<string, Entry>();

export function emptyState<T>(): CacheState<T> {
  return EMPTY_STATE;
}

export function getState<T>(key: string): CacheState<T> {
  return (entries.get(key)?.state as CacheState<T> | undefined) ?? EMPTY_STATE;
}

function setState(entry: Entry, state: CacheState<unknown>): void {
  entry.state = state;
  for (const listener of [...entry.listeners]) listener();
}

function getOrCreateEntry(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { state: EMPTY_STATE, loader: null, inflight: null, generation: 0, listeners: new Set() };
    entries.set(key, entry);
  }
  return entry;
}

/** Entries nobody listens to and that hold no data (failed prefetch, abandoned error) are not worth keeping. */
function dropIfUseless(key: string, entry: Entry): void {
  if (entries.get(key) === entry && entry.listeners.size === 0 && entry.state.data === null && !entry.inflight) {
    entries.delete(key);
  }
}

function startFetch(key: string, entry: Entry, quietOnError: boolean): Promise<void> {
  if (entry.inflight) return entry.inflight;
  const loader = entry.loader;
  if (!loader) return Promise.resolve();
  const generation = entry.generation;
  const isCurrent = () => entries.get(key) === entry && entry.generation === generation;

  const run = async (): Promise<void> => {
    try {
      const data = await loader();
      if (isCurrent()) setState(entry, { data, error: null, fetchedAt: Date.now() });
    } catch (caught: unknown) {
      if (!isCurrent()) return;
      if (quietOnError && entry.state.data !== null) return;
      setState(entry, { ...entry.state, error: errorMessage(caught) });
    }
  };
  const inflight: Promise<void> = run().finally(() => {
    if (entry.inflight === inflight) entry.inflight = null;
    dropIfUseless(key, entry);
  });
  entry.inflight = inflight;
  return inflight;
}

/** Loads what is missing, or refreshes in the background what is stale; does nothing for fresh data. */
function ensureFresh(key: string, entry: Entry): Promise<void> {
  if (entry.state.data === null) {
    if (entry.state.error !== null) setState(entry, EMPTY_STATE);
    return startFetch(key, entry, false);
  }
  if (Date.now() - entry.state.fetchedAt >= STALE_MS) return startFetch(key, entry, true);
  return entry.inflight ?? Promise.resolve();
}

/**
 * Registers a hook on `key` and starts loading if needed. Returns the unsubscribe function (React's
 * `useSyncExternalStore` contract). `load` is the latest loader for the key.
 */
export function subscribe(key: string, listener: () => void, load: Loader): () => void {
  const entry = getOrCreateEntry(key);
  entry.loader = load;
  entry.listeners.add(listener);
  void ensureFresh(key, entry);
  return () => {
    entry.listeners.delete(listener);
    dropIfUseless(key, entry);
  };
}

/** Explicit refetch (a "Try again" button): reuses a request that is already running. */
export function refetch(key: string): Promise<void> {
  const entry = entries.get(key);
  if (!entry) return Promise.resolve();
  if (entry.state.error !== null) setState(entry, { ...entry.state, error: null });
  return startFetch(key, entry, false);
}

/** Warms `key` without a mounted hook (hover/focus on a nav link); fresh data is left alone. */
export function prefetch(key: string, load: Loader): Promise<void> {
  const entry = getOrCreateEntry(key);
  entry.loader = load;
  return ensureFresh(key, entry);
}

function matches(key: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => key === pattern || key.startsWith(`${pattern}:`));
}

/**
 * Call after a mutation. Keys with a mounted hook refetch now and keep showing their data meanwhile; the rest are
 * dropped. Resolves when those refetches have settled (never rejects), so a mutation can wait for fresh data.
 */
export function invalidate(keys?: readonly string[]): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const [key, entry] of [...entries]) {
    if (keys && !matches(key, keys)) continue;
    entry.generation += 1;
    entry.inflight = null;
    if (entry.listeners.size > 0) pending.push(startFetch(key, entry, false));
    else entries.delete(key);
  }
  return Promise.all(pending).then(() => undefined);
}

/** Test helper: forgets everything. */
export function resetCache(): void {
  entries.clear();
}
