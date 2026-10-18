"use client";

import { useEffect, useState } from "react";
import { getGmailSyncStatus } from "@/lib/api/client";
import type { GmailSyncStatus } from "@/lib/api/types";

/** How often the status of a running Gmail sync is read (GET /api/gmail/sync/status is local-only and cheap). */
export const SYNC_STATUS_POLL_MS = 1500;

/**
 * Reads `fetchStatus` now and then every `intervalMs` until the returned function is called. Requests never overlap
 * (a slow response skips ticks), and a failed read is ignored: the next tick tries again.
 */
export function pollGmailSyncStatus(
  fetchStatus: () => Promise<GmailSyncStatus>,
  onStatus: (status: GmailSyncStatus) => void,
  intervalMs: number = SYNC_STATUS_POLL_MS,
): () => void {
  let stopped = false;
  let inFlight = false;

  const tick = () => {
    if (inFlight) return;
    inFlight = true;
    fetchStatus()
      .then((status) => {
        if (!stopped) onStatus(status);
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Live progress of the Gmail sync for this account, polled only while `active` (a sync is running). Null until the
 * first answer and whenever inactive. Stages `idle`, `complete` and `failed` can be left over from an earlier run.
 */
export function useGmailSyncStatus(active: boolean): GmailSyncStatus | null {
  const [status, setStatus] = useState<GmailSyncStatus | null>(null);

  useEffect(() => {
    if (!active) {
      setStatus(null);
      return;
    }
    return pollGmailSyncStatus(getGmailSyncStatus, setStatus);
  }, [active]);

  return active ? status : null;
}
