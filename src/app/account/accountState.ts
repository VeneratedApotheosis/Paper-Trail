import type { AccountGmailStatus, AccountSourceKind, AccountViewData } from "@/components/views/AccountView";
import type { AccountResponse } from "@/lib/api/types";
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
