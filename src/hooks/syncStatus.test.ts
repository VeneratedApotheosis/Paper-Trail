import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailSyncStatus } from "@/lib/api/types";
import { SYNC_STATUS_POLL_MS, pollGmailSyncStatus } from "./syncStatus";

const listing: GmailSyncStatus = { stage: "listing", fetched: 0, total: null, skipped: 0 };
const fetching: GmailSyncStatus = { stage: "fetching", fetched: 12, total: 50, skipped: 0 };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("pollGmailSyncStatus", () => {
  it("reads once right away, then every interval, and stops when told to", async () => {
    const fetchStatus = vi.fn().mockResolvedValueOnce(listing).mockResolvedValue(fetching);
    const seen: GmailSyncStatus[] = [];
    const stop = pollGmailSyncStatus(fetchStatus, (status) => seen.push(status));

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SYNC_STATUS_POLL_MS);
    await vi.advanceTimersByTimeAsync(SYNC_STATUS_POLL_MS);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(seen).toEqual([listing, fetching, fetching]);

    stop();
    await vi.advanceTimersByTimeAsync(SYNC_STATUS_POLL_MS * 3);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it("polls about every 1.5 seconds", () => {
    expect(SYNC_STATUS_POLL_MS).toBe(1500);
  });

  it("does not start a second request while one is still pending", async () => {
    let resolve: (status: GmailSyncStatus) => void = () => {};
    const fetchStatus = vi.fn(() => new Promise<GmailSyncStatus>((done) => (resolve = done)));
    const stop = pollGmailSyncStatus(fetchStatus, () => {});

    await vi.advanceTimersByTimeAsync(SYNC_STATUS_POLL_MS * 3);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    resolve(listing);
    await vi.advanceTimersByTimeAsync(SYNC_STATUS_POLL_MS);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    stop();
  });

  it("ignores a failed read and an answer that arrives after stopping", async () => {
    const fetchStatus = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(fetching);
    const onStatus = vi.fn();
    const stop = pollGmailSyncStatus(fetchStatus, onStatus);

    await vi.advanceTimersByTimeAsync(0);
    expect(onStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SYNC_STATUS_POLL_MS);
    expect(onStatus).toHaveBeenCalledWith(fetching);

    onStatus.mockClear();
    await vi.advanceTimersByTimeAsync(SYNC_STATUS_POLL_MS - 1);
    stop();
    await vi.advanceTimersByTimeAsync(10);
    expect(onStatus).not.toHaveBeenCalled();
  });
});
