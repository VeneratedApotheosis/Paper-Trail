// Pure rules for the global "Sync emails" button (issue #112): which state it is in, its "Last synced" text, and the
// messages after a sync. The React side (gmailSyncControl.ts) only wires these to requests.
import type {
  AppShellSyncAccountProgress,
  AppShellSyncConfirm,
  AppShellSyncNotice,
  AppShellSyncNoticeAccount,
  AppShellSyncProgress,
  AppShellSyncState,
} from "@/components/views/AppShellView";
import { gmailErrorCopy, gmailProgress } from "@/app/sync/syncOutcome";
import type {
  AccountResponse,
  GmailAccountSync,
  GmailFailure,
  GmailPreviewResponse,
  GmailSyncResponse,
  GmailSyncStatus,
} from "@/lib/api/types";
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
export function confirmFromPreview(
  preview: Pick<GmailPreviewResponse, "messagesToFetch" | "maxMessages" | "windowDays"> & Partial<Pick<GmailPreviewResponse, "accounts" | "redaction">>,
): Extract<AppShellSyncConfirm, { status: "ready" }> {
  // Accounts that answered the preview are the ones a sync reads; the cap is per account.
  const readable = preview.accounts?.filter((account) => account.ok).length ?? 0;
  return {
    status: "ready",
    messageCount: preview.messagesToFetch > 0 ? preview.messagesToFetch : preview.maxMessages * Math.max(1, readable),
    windowDays: preview.windowDays,
    ...(readable > 1 ? { accountCount: readable } : {}),
    ...(preview.redaction ? { redaction: preview.redaction } : {}),
  };
}

const ACCOUNT_STAGE_DETAIL = {
  idle: "waiting",
  listing: "listing emails",
  processing: "analyzing receipts",
  complete: "done",
  failed: "could not sync",
} as const;

export const UNKNOWN_MAILBOX_LABEL = "Gmail account";

/** One account's line of the live progress: "work@example.com  12 of 50", "personal@example.com  waiting". */
export function accountProgressLine(account: NonNullable<GmailSyncStatus["accounts"]>[number]): AppShellSyncAccountProgress {
  const detail =
    account.stage === "fetching"
      ? account.total !== null
        ? `${account.fetched} of ${account.total}`
        : "reading"
      : ACCOUNT_STAGE_DETAIL[account.stage];
  return { accountId: account.accountId, label: account.mailbox ?? UNKNOWN_MAILBOX_LABEL, detail };
}

/**
 * The status as button/popover progress: the whole sync's counts (only for an in-flight stage, see `gmailProgress`) plus,
 * while two or more accounts sync, a line per account. Null when nothing is in flight.
 */
export function shellProgress(status: GmailSyncStatus | null): AppShellSyncProgress | null {
  const progress = gmailProgress(status);
  if (!progress) return null;
  const { stage, fetched, total } = progress;
  const accounts = status?.accounts;
  return { stage, fetched, total, ...(accounts && accounts.length > 1 ? { accounts: accounts.map(accountProgressLine) } : {}) };
}

const ACCOUNT_FAILURE_TEXT: Record<string, string> = {
  token_expired: "Needs reconnect",
  gmail_access_denied: "Access denied, reconnect",
  sync_timeout: "Took too long",
  gmail_rate_limited: "Gmail asked to slow down",
};
/** Failures where only a fresh Google consent helps. */
const RECONNECT_CODES = new Set(["token_expired", "gmail_access_denied"]);

/** How one account ended: "Read 20 emails", or why it could not be read (with a reconnect hint for an expired grant). */
export function accountSyncLine(entry: GmailAccountSync): AppShellSyncNoticeAccount {
  const label = entry.mailbox ?? UNKNOWN_MAILBOX_LABEL;
  if (!entry.ok) {
    return { accountId: entry.accountId, label, ok: false, text: ACCOUNT_FAILURE_TEXT[entry.code] ?? "Could not sync", reconnect: RECONNECT_CODES.has(entry.code) };
  }
  const emails = `Read ${entry.fetched} email${entry.fetched === 1 ? "" : "s"}`;
  return { accountId: entry.accountId, label, ok: true, text: entry.capped ? `${emails} (limit reached)` : emails };
}

/**
 * "Synced 12 purchases", from the real sync result. With two or more accounts it lists how each went; when some failed
 * and others succeeded it says so (an error notice that stays until dismissed) and offers Reconnect for expired ones.
 */
export function syncSuccessNotice(response: Pick<GmailSyncResponse, "stats"> & Partial<Pick<GmailSyncResponse, "accounts">>): AppShellSyncNotice {
  const orders = response.stats.orders;
  const needsCheck = response.stats.needsReview;
  const text = orders === 0 ? "Sync finished, no purchases found" : `Synced ${orders} purchase${orders === 1 ? "" : "s"}`;
  const needsCheckText = needsCheck > 0 ? `${needsCheck} ${needsCheck === 1 ? "item needs" : "items need"} a check in Review.` : undefined;
  const entries = response.accounts ?? [];
  if (entries.length < 2) return { tone: "success", text, detail: needsCheckText };

  const accounts = entries.map(accountSyncLine);
  const failed = accounts.filter((account) => !account.ok);
  if (failed.length === 0) return { tone: "success", text, detail: needsCheckText, accounts };
  const reconnect = failed.some((account) => account.reconnect);
  const advice = reconnect ? "Reconnect the account that needs it, then sync again." : "Try the account that failed again in a moment.";
  return {
    tone: "error",
    text: `Synced ${accounts.length - failed.length} of ${accounts.length} accounts`,
    detail: [`Purchases from the accounts that worked were saved.`, advice, needsCheckText].filter(Boolean).join(" "),
    reconnect,
    accounts,
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
