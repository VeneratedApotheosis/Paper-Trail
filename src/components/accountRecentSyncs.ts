import type { AccountRow } from "@/components/GmailAccountsSection";

// "Recent syncs" in the Account right rail: one line per mailbox that has been synced, from values already on screen
// (the account rows, or the single mailbox). It states the last sync only; no counts are invented.

export interface RecentSync {
  key: string;
  /** Absolute time of the sync, e.g. "Oct 18, 2026, 1:02 AM". */
  when: string;
  /** "work.shopper@example.com: synced 5 minutes ago". */
  text: string;
}

export function recentSyncs(input: {
  accounts: readonly AccountRow[];
  mailbox: string | null;
  lastSync: { relative: string; absolute: string } | null;
}): RecentSync[] {
  if (input.accounts.length > 0) {
    return input.accounts.flatMap((account) =>
      account.lastSync
        ? [{ key: account.id, when: account.lastSync.absolute, text: `${account.label}: synced ${account.lastSync.relative}` }]
        : [],
    );
  }
  if (!input.lastSync) return [];
  return [{ key: "single", when: input.lastSync.absolute, text: `${input.mailbox ?? "Gmail"}: synced ${input.lastSync.relative}` }];
}