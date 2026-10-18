// Pure rules for the global "Sync emails" button (issue #112): which state it is in, its "Last synced" text, and the
// messages after a sync. The React side (gmailSyncControl.ts) only wires these to requests.
import type { AppShellSyncConfirm, AppShellSyncNotice, AppShellSyncState } from "@/components/views/AppShellView";
import { gmailErrorCopy } from "@/app/sync/syncOutcome";
import type { AccountResponse, GmailFailure, GmailPreviewResponse, GmailSyncResponse } from "@/lib/api/types";
import { relativeTimeLabel } from "./timeLabels";

type SyncAccount = Pick<AccountResponse, "gmail" | "mode" | "syncing" | "lastSyncAt">;

/**
 * State machine of the button, first match wins:
 * - a sync started from this tab, or the server says one is running for the account -> running (disabled, shows progress)
 * - account not loaded yet -> checking (disabled, same width, so the header does not jump)
 * - Gmail grant gone (expired, revoked) -> reconnect
 * - Gmail connected and the ledger is Gmail data or empty -> ready (click = confirm, then sync)
 * - anything else (not connected, demo or uploaded data) -> connect: it opens /connect and never replaces data silently
 */
export function deriveSyncButtonState(account: SyncAccount | null, startedHere: boolean): AppShellSyncState {
  if (startedHere) return "running";
  if (!account) return "checking";
  if (account.syncing && account.gmail.connected) return "running";
  if (account.gmail.expired) return "reconnect";
  if (account.gmail.connected && (account.mode === "gmail" || account.mode === "empty")) return "ready";
  return "connect";
}

/** "Last synced 5 minutes ago". Never synced: "Not synced yet" when a sync is possible, otherwise nothing to say. */
export function lastSyncLabel(account: SyncAccount | null, state: AppShellSyncState, now: Date): string | undefined {
  if (!account) return undefined;
  if (account.lastSyncAt) return `Last synced ${relativeTimeLabel(account.lastSyncAt, now)}`;
  return state === "ready" || state === "running" ? "Not synced yet" : undefined;
}

/** The confirm text's numbers: what a sync would read, from GET /api/gmail/preview. */
export function confirmFromPreview(preview: Pick<GmailPreviewResponse, "messagesToFetch" | "maxMessages" | "windowDays">): Extract<AppShellSyncConfirm, { status: "ready" }> {
  return {
    status: "ready",
    messageCount: preview.messagesToFetch > 0 ? preview.messagesToFetch : preview.maxMessages,
    windowDays: preview.windowDays,
  };
}

/** "Synced 12 purchases", from the real sync result. */
export function syncSuccessNotice(response: Pick<GmailSyncResponse, "stats">): AppShellSyncNotice {
  const orders = response.stats.orders;
  const needsCheck = response.stats.needsReview;
  const text = orders === 0 ? "Sync finished, no purchases found" : `Synced ${orders} purchase${orders === 1 ? "" : "s"}`;
  return {
    tone: "success",
    text,
    detail: needsCheck > 0 ? `${needsCheck} ${needsCheck === 1 ? "item needs" : "items need"} a check in Review.` : undefined,
  };
}

/** A failed preview or sync as an honest message; expired or refused access adds a Reconnect Gmail action. */
export function syncFailureNotice(failure: GmailFailure, during: "preview" | "sync"): AppShellSyncNotice {
  const copy = gmailErrorCopy(failure, during);
  return {
    tone: "error",
    text: copy.title,
    detail: `${copy.what} ${copy.fix}`,
    reconnect: copy.kind === "reconnect" || copy.kind === "access_denied",
  };
}
