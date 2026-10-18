"use client";

// One Gmail sync at a time per browser tab (the server allows one per account anyway). The app shell's "Sync emails"
// button and the /sync page both start syncs through `runGmailSync`, so each can tell when the other's sync is
// running and the button never starts a second one. The flag lives at module level: it survives navigation.
import { useSyncExternalStore } from "react";
import { ApiError, syncGmail } from "@/lib/api/client";
import type { GmailSyncResponse } from "@/lib/api/types";
import { invalidate } from "./cache";

let running = false;
const listeners = new Set<() => void>();

function setRunning(next: boolean): void {
  running = next;
  for (const listener of [...listeners]) listener();
}

export function isSyncRunning(): boolean {
  return running;
}

/** True while a sync started from this tab is in flight. */
export function useSyncRunning(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isSyncRunning,
    () => false,
  );
}

/**
 * POST /api/gmail/sync (the user already confirmed the preview). Whether it succeeds or fails, a sync can change the
 * ledger, audit log, account and mode, so every cached read is refreshed before the running flag drops.
 */
export async function runGmailSync(): Promise<GmailSyncResponse> {
  if (running) {
    throw new ApiError(409, { error: "A Gmail sync is already running.", code: "sync_already_running" });
  }
  setRunning(true);
  try {
    return await syncGmail();
  } finally {
    await invalidate();
    setRunning(false);
  }
}
