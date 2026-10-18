import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_KEYS, STALE_MS, getState, invalidate, prefetch, refetch, resetCache, subscribe } from "./cache";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets promise callbacks (including `.finally`) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** A loader whose responses the test resolves one request at a time. */
function controlledLoader<T>() {
  const requests: Deferred<T>[] = [];
  const load = vi.fn(() => {
    const request = deferred<T>();
    requests.push(request);
    return request.promise;
  });
  return { load, requests };
}

beforeEach(() => {
  resetCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("shared read cache", () => {
  it("loads once for several subscribers of the same key and notifies each of them", async () => {
    const { load, requests } = controlledLoader<string>();
    const first = vi.fn();
    const second = vi.fn();
    subscribe("ledger", first, load);
    subscribe("ledger", second, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(getState("ledger").data).toBeNull();

    requests[0].resolve("ledger-v1");
    await flush();

    expect(getState("ledger")).toMatchObject({ data: "ledger-v1", error: null });
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it("serves cached data immediately and does not refetch while it is fresh", async () => {
    const { load, requests } = controlledLoader<string>();
    const unsubscribe = subscribe("ledger", vi.fn(), load);
    requests[0].resolve("v1");
    await flush();
    unsubscribe();

    vi.advanceTimersByTime(STALE_MS - 1);
    subscribe("ledger", vi.fn(), load);

    expect(getState("ledger").data).toBe("v1");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps showing stale data while it refreshes in the background, then swaps in the new data", async () => {
    const { load, requests } = controlledLoader<string>();
    const unsubscribe = subscribe("ledger", vi.fn(), load);
    requests[0].resolve("v1");
    await flush();
    unsubscribe();

    vi.advanceTimersByTime(STALE_MS);
    subscribe("ledger", vi.fn(), load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(getState("ledger").data).toBe("v1");

    requests[1].resolve("v2");
    await flush();
    expect(getState("ledger").data).toBe("v2");
  });

  it("swallows a failed background refresh and keeps the cached data", async () => {
    const { load, requests } = controlledLoader<string>();
    const unsubscribe = subscribe("ledger", vi.fn(), load);
    requests[0].resolve("v1");
    await flush();
    unsubscribe();

    vi.advanceTimersByTime(STALE_MS);
    subscribe("ledger", vi.fn(), load);
    requests[1].reject(new Error("offline"));
    await flush();

    expect(getState("ledger")).toMatchObject({ data: "v1", error: null });
  });

  it("reports a failed first load, and a remount clears the error and tries again", async () => {
    const { load, requests } = controlledLoader<string>();
    const unsubscribe = subscribe("ledger", vi.fn(), load);
    requests[0].reject(new Error("API down"));
    await flush();
    expect(getState("ledger")).toMatchObject({ data: null, error: "API down" });

    unsubscribe();
    expect(getState("ledger").error).toBeNull();

    subscribe("ledger", vi.fn(), load);
    expect(load).toHaveBeenCalledTimes(2);
    requests[1].resolve("v1");
    await flush();
    expect(getState("ledger")).toMatchObject({ data: "v1", error: null });
  });

  it("explicit refetch reuses a running request, reports a failure next to the cached data, and a success clears it", async () => {
    const { load, requests } = controlledLoader<string>();
    subscribe("ledger", vi.fn(), load);
    void refetch("ledger");
    expect(load).toHaveBeenCalledTimes(1);
    requests[0].resolve("v1");
    await flush();

    void refetch("ledger");
    requests[1].reject(new Error("503"));
    await flush();
    expect(getState("ledger")).toMatchObject({ data: "v1", error: "503" });

    void refetch("ledger");
    expect(getState("ledger").error).toBeNull();
    requests[2].resolve("v2");
    await flush();
    expect(getState("ledger")).toMatchObject({ data: "v2", error: null });
  });

  it("invalidate refetches keys that are mounted, keeps their data meanwhile, and resolves once fresh", async () => {
    const { load, requests } = controlledLoader<string>();
    subscribe("ledger", vi.fn(), load);
    requests[0].resolve("before");
    await flush();

    let settled = false;
    const done = invalidate(["ledger"]).then(() => {
      settled = true;
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(getState("ledger").data).toBe("before");
    await flush();
    expect(settled).toBe(false);

    requests[1].resolve("after");
    await done;
    expect(getState("ledger").data).toBe("after");
  });

  it("invalidate drops keys nobody is looking at, so the next visit never shows pre-mutation data", async () => {
    const { load, requests } = controlledLoader<string>();
    const unsubscribe = subscribe("audit", vi.fn(), load);
    requests[0].resolve("old audit");
    await flush();
    unsubscribe();

    await invalidate(["audit"]);
    expect(getState("audit").data).toBeNull();

    subscribe("audit", vi.fn(), load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("ignores a response that was already in flight when its key was invalidated", async () => {
    const { load, requests } = controlledLoader<string>();
    subscribe("ledger", vi.fn(), load);
    const stale = invalidate(["ledger"]);
    expect(load).toHaveBeenCalledTimes(2);

    requests[0].resolve("pre-mutation");
    await flush();
    expect(getState("ledger").data).toBeNull();

    requests[1].resolve("post-mutation");
    await stale;
    expect(getState("ledger").data).toBe("post-mutation");
  });

  it("matches a kind to every id-scoped key and everything when no keys are given", async () => {
    const loaders = {
      ledger: controlledLoader<string>(),
      orderA: controlledLoader<string>(),
      orderB: controlledLoader<string>(),
      session: controlledLoader<string>(),
      account: controlledLoader<string>(),
    };
    subscribe(CACHE_KEYS.ledger, vi.fn(), loaders.ledger.load);
    subscribe(CACHE_KEYS.account, vi.fn(), loaders.account.load);
    subscribe(CACHE_KEYS.order("a"), vi.fn(), loaders.orderA.load);
    subscribe(CACHE_KEYS.order("b"), vi.fn(), loaders.orderB.load);
    subscribe(CACHE_KEYS.session, vi.fn(), loaders.session.load);

    void invalidate(["order"]);
    expect(loaders.orderA.load).toHaveBeenCalledTimes(2);
    expect(loaders.orderB.load).toHaveBeenCalledTimes(2);
    expect(loaders.ledger.load).toHaveBeenCalledTimes(1);
    expect(loaders.account.load).toHaveBeenCalledTimes(1);

    void invalidate();
    expect(loaders.ledger.load).toHaveBeenCalledTimes(2);
    expect(loaders.session.load).toHaveBeenCalledTimes(2);
    expect(loaders.account.load).toHaveBeenCalledTimes(2);
  });

  it("reports an error from an invalidate refetch while keeping the data", async () => {
    const { load, requests } = controlledLoader<string>();
    subscribe("ledger", vi.fn(), load);
    requests[0].resolve("v1");
    await flush();

    const refreshed = invalidate(["ledger"]);
    requests[1].reject(new Error("boom"));
    await refreshed;

    expect(getState("ledger")).toMatchObject({ data: "v1", error: "boom" });
  });

  it("prefetch warms a key without a subscriber, so the page mounts with data and no second request", async () => {
    const { load, requests } = controlledLoader<string>();
    const warmed = prefetch("ledger", load);
    requests[0].resolve("warm");
    await warmed;

    subscribe("ledger", vi.fn(), load);
    expect(getState("ledger").data).toBe("warm");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("prefetch of a fresh key does nothing, and a failed prefetch leaves no entry behind", async () => {
    const ok = controlledLoader<string>();
    const first = prefetch("ledger", ok.load);
    ok.requests[0].resolve("v1");
    await first;
    await prefetch("ledger", ok.load);
    expect(ok.load).toHaveBeenCalledTimes(1);

    const failing = controlledLoader<string>();
    const failed = prefetch("audit", failing.load);
    failing.requests[0].reject(new Error("nope"));
    await failed;
    expect(getState("audit")).toMatchObject({ data: null, error: null });
  });

  it("stops notifying an unsubscribed listener", async () => {
    const { load, requests } = controlledLoader<string>();
    const listener = vi.fn();
    const unsubscribe = subscribe("ledger", listener, load);
    unsubscribe();
    requests[0].resolve("v1");
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });
});
