import { accountLabels } from "@/components/sourceAccounts";
import type { AccountGmailStatus, AccountRow, AccountRowStatus, AccountSourceKind, AccountViewData } from "@/components/views/AccountView";
import type { AppShellSync } from "@/components/views/AppShellView";
import type { AccountResponse, LinkedAccount } from "@/lib/api/types";
import { absoluteTimeLabel, relativeTimeLabel } from "@/hooks/timeLabels";

// Pure GET /api/account -> AccountView props mapping (issue #110). Every value shown comes from the response; the page
// only adds whether a sync started from this tab is running.

export const GMAIL_DISCONNECTED_SOURCE_LABEL = "Gmail disconnected: your synced purchases are kept";

export function gmailStatusOf(gmail: Pick<AccountResponse["gmail"], "connected" | "expired">): AccountGmailStatus {
  if (gmail.connected) return "connected";
  return gmail.expired ? "expired" : "not_connected";
}

const SOURCES: Record<Exclude<AccountSourceKind, "gmail_disconnected">, { label: string; detail: string }> = {
  demo: { label: "Demo data", detail: "Synthetic purchases, not from a real inbox." },
  gmail: { label: "Gmail", detail: "Purchases read from your mailbox." },
  upload: { label: "Uploaded files", detail: "Purchases imported from .eml or .mbox files." },
  empty: { label: "No data yet", detail: "Sync your emails, upload files or try the demo data." },
};

/** Gmail data stays after Disconnect Gmail: say so instead of claiming a live connection. */
export function sourceOf(account: Pick<AccountResponse, "mode" | "gmail" | "counts">): AccountViewData["source"] {
  if (account.mode === "gmail" && !account.gmail.connected) {
    if (account.counts.orders > 0) {
      return {
        kind: "gmail_disconnected",
        label: GMAIL_DISCONNECTED_SOURCE_LABEL,
        detail: "Connect Gmail again to read new receipts.",
      };
    }
    return { kind: "empty", ...SOURCES.empty };
  }
  return { kind: account.mode, ...SOURCES[account.mode] };
}

/**
 * connected: readable now. A known address without a grant: Google ended access (expired). No address and no grant: the
 * account was disconnected. Both need a reconnect; the purchases of either are kept.
 */
export function accountRowStatus(account: Pick<LinkedAccount, "connected" | "mailbox">): AccountRowStatus {
  if (account.connected) return "connected";
  return account.mailbox !== null ? "expired" : "disconnected";
}

/** What a syncing row says: this account's own line while several sync, else the whole sync's counts. */
function rowSyncDetail(accountId: string, progress: AppShellSync["progress"]): string {
  const line = progress?.accounts?.find((entry) => entry.accountId === accountId);
  if (line) {
    if (line.detail === "waiting") return "Waiting for its turn";
    if (line.detail === "done") return "Done";
    return `Syncing, ${line.detail}`;
  }
  if (progress?.stage === "fetching" && progress.total !== null) return `Reading ${progress.fetched} of ${progress.total}`;
  return "Syncing";
}

/**
 * One row per linked account (GET /api/account `accounts`). While a sync runs, the accounts it covers are marked: the
 * target account for a sync of one, every connected account for a sync of all (with progress per account when the
 * status carries it).
 */
export function buildAccountRows(
  accounts: readonly LinkedAccount[],
  sync: Pick<AppShellSync, "state" | "progress" | "targetAccountId"> | null,
  now: Date,
): AccountRow[] {
  const labels = accountLabels(accounts);
  const running = sync?.state === "running";
  const target = sync?.targetAccountId ?? null;
  const perAccount = sync?.progress?.accounts;
  return accounts.map((account) => {
    const covered = running && account.connected && (target === null || target === account.id);
    const listed = perAccount === undefined || perAccount.some((entry) => entry.accountId === account.id);
    const syncing = covered && listed;
    return {
      id: account.id,
      label: labels.get(account.id)!,
      status: accountRowStatus(account),
      lastSync: account.lastSyncAt
        ? { relative: relativeTimeLabel(account.lastSyncAt, now), absolute: absoluteTimeLabel(account.lastSyncAt) }
        : null,
      syncing,
      syncDetail: syncing ? rowSyncDetail(account.id, sync?.progress) : null,
    };
  });
}

export function buildAccountViewData(account: AccountResponse, syncRunningHere: boolean, now: Date): AccountViewData {
  return {
    gmail: { status: gmailStatusOf(account.gmail), mailbox: account.gmail.connected ? account.gmail.mailbox : null },
    source: sourceOf(account),
    lastSync: account.lastSyncAt
      ? { relative: relativeTimeLabel(account.lastSyncAt, now), absolute: absoluteTimeLabel(account.lastSyncAt) }
      : null,
    counts: {
      purchases: account.counts.orders,
      findings: account.counts.findings,
      needsCheck: account.counts.reviewItems,
    },
    excludedStores: account.excludedMerchants.length,
    syncing: syncRunningHere || (account.syncing && account.gmail.connected),
  };
}
