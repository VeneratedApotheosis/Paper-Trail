import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { GmailSyncResponse } from "@/lib/api/types";
import { resetCache, subscribe, getState, CACHE_KEYS } from "./cache";

const syncGmailMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  syncGmail: syncGmailMock,
}));

import { isSyncRunning, runGmailSync } from "./syncRun";

const response = { stats: { orders: 3 } } as GmailSyncResponse;

beforeEach(() => {
  resetCache();
  syncGmailMock.mockReset();
});
afterEach(() => {
  resetCache();
});

describe("runGmailSync", () => {
  it("marks a sync as running until it finished and the cache was refreshed", async () => {
    let finish: (value: GmailSyncResponse) => void = () => {};
    syncGmailMock.mockReturnValue(new Promise<GmailSyncResponse>((resolve) => (finish = resolve)));
    const ledgerLoader = vi.fn().mockResolvedValue({ mode: "gmail" });
    subscribe(CACHE_KEYS.ledger, () => {}, ledgerLoader);
    await vi.waitFor(() => expect(getState(CACHE_KEYS.ledger).data).not.toBeNull());
    ledgerLoader.mockClear();

    const run = runGmailSync();
    expect(isSyncRunning()).toBe(true);
    finish(response);
    await expect(run).resolves.toBe(response);

    expect(isSyncRunning()).toBe(false);
    expect(ledgerLoader).toHaveBeenCalledTimes(1);
  });

  it("refuses a second sync while one runs and keeps the flag until the first ends", async () => {
    let finish: (value: GmailSyncResponse) => void = () => {};
    syncGmailMock.mockReturnValue(new Promise<GmailSyncResponse>((resolve) => (finish = resolve)));
    const first = runGmailSync();

    const second = await runGmailSync().catch((caught: unknown) => caught);
    expect(second).toBeInstanceOf(ApiError);
    expect(second).toMatchObject({ status: 409, body: { code: "sync_already_running" } });
    expect(syncGmailMock).toHaveBeenCalledTimes(1);
    expect(isSyncRunning()).toBe(true);

    finish(response);
    await first;
    expect(isSyncRunning()).toBe(false);
  });

  it("clears the flag and rethrows when the sync fails", async () => {
    const failure = new ApiError(504, { error: "Gmail sync did not complete. Try again.", code: "sync_timeout" });
    syncGmailMock.mockRejectedValue(failure);
    await expect(runGmailSync()).rejects.toBe(failure);
    expect(isSyncRunning()).toBe(false);
  });
});
