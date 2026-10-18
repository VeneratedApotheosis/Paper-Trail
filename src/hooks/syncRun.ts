"use client";

// One Gmail sync at a time per browser tab (the server allows one per profile anyway). The app shell's "Sync emails"
// button, the Account page and the /sync page all start syncs through `runGmailSync`, so each can tell when another's
// sync is running and nothing starts a second one. The flag lives at module level: it survives navigation. It also
// remembers which account a running sync is for (null = every connected account), so the Account page can mark that row.
import { useSyncExternalStore } from "react";
import { ApiError, syncGmail } from "@/lib/api/client";
import type { GmailSyncResponse } from "@/lib/api/types";
import { invalidate } from "./cache";

let running = false;
let runningAccountId: string | null = null;
const listeners = new Set<() => void>();

function setRunning(next: boolean, accountId: string | null = null): void {
  running = next;
  runningAccountId = next ? accountId : null;
  for (const listener of [...listeners]) listener();
}

export function isSyncRunning(): boolean {
  return running;
}

/** The account the running sync is for; null when it syncs every connected account or none runs. */
export function runningSyncAccountId(): string | null {
  return runningAccountId;
}

function subscribeToRunning(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while a sync started from this tab is in flight. */
export function useSyncRunning(): boolean {
  return useSyncExternalStore(subscribeToRunning, isSyncRunning, () => false);
}

/** The account a sync started from this tab is syncing; null for "all connected accounts" and while none runs. */
export function useRunningSyncAccountId(): string | null {
  return useSyncExternalStore(subscribeToRunning, runningSyncAccountId, () => null);
}

/**
 * POST /api/gmail/sync (the user already confirmed the preview), for one linked account or, without `accountId`, every
 * connected one. Whether it succeeds or fails, a sync can change the ledger, audit log, account and mode, so every
 * cached read (account and ledger included) is refreshed before the running flag drops.
 */
export async function runGmailSync(options: { accountId?: string } = {}): Promise<GmailSyncResponse> {
  if (running) {
    throw new ApiError(409, { error: "A Gmail sync is already running.", code: "sync_already_running" });
  }
  setRunning(true, options.accountId ?? null);
  try {
    return await syncGmail(options);
  } finally {
    await invalidate();
    setRunning(false);
  }
}
