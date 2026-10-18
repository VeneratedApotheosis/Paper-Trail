import type { AccountRow, AccountViewProps } from "@/components/views/AccountView";
import type { AppShellSync } from "@/components/views/AppShellView";

// Sample props for previewing AccountView in isolation and for tests: one entry per state of the Account screen.
// Synthetic values only (example.com addresses).

const noop = () => {};
const handlers = {
  onSync: noop,
  onConnect: noop,
  onRequestDisconnect: noop,
  onConfirmDisconnect: noop,
  onCancelDisconnect: noop,
  onLeaveDemo: noop,
  onAddAccount: noop,
  onReconnectAccount: noop,
};
const idle = { disconnectStep: "idle", leaveDemoPending: false, actionError: null } as const;
const lastSync = { relative: "5 minutes ago", absolute: "Oct 18, 2026, 1:02 AM" };

const connected: AccountViewProps = {
  gmail: { status: "connected", mailbox: "shopper@example.com" },
  source: { kind: "gmail", label: "Gmail", detail: "Purchases read from your mailbox." },
  lastSync,
  counts: { purchases: 45, findings: 6, needsCheck: 2 },
  excludedStores: 1,
  syncing: false,
  ...idle,
  ...handlers,
};

// Linked Gmail accounts (issue #115). Account ids are opaque; addresses are synthetic.
const syncHandlers = { onSync: noop, onSyncAccount: noop, onConnect: noop, onStartSync: noop, onCancelSync: noop, onDismissNotice: noop };
const idleSync: AppShellSync = { state: "ready", lastSyncLabel: "Last synced 5 minutes ago", ...syncHandlers };
const row = (overrides: Partial<AccountRow> & Pick<AccountRow, "id" | "label">): AccountRow => ({
  status: "connected",
  lastSync,
  syncing: false,
  syncDetail: null,
  ...overrides,
});
const work = row({ id: "acct-work", label: "work.shopper@example.com" });
const home = row({ id: "acct-home", label: "home@example.com", lastSync: { relative: "2 hours ago", absolute: "Oct 17, 2026, 11:10 PM" } });
const expiredRow = row({ id: "acct-home", label: "home@example.com", status: "expired", lastSync: { relative: "3 days ago", absolute: "Oct 15, 2026, 9:30 AM" } });
const disconnectedRow = row({ id: "acct-old", label: "Disconnected account", status: "disconnected", lastSync: null });
const withAccounts = (accounts: AccountRow[], sync: AppShellSync = idleSync): AccountViewProps => ({
  ...connected,
  gmail: { status: "connected", mailbox: accounts[0].label },
  accounts,
  sync,
});

const accountListFixtures = {
  accountsOne: withAccounts([work]),
  accountsTwo: withAccounts([work, home]),
  /** One connected, one expired, one disconnected. */
  accountsThree: withAccounts([work, expiredRow, disconnectedRow]),
  accountsConfirmSyncOne: withAccounts([work, home], {
    ...idleSync,
    confirm: { status: "ready", messageCount: 31, windowDays: 90 },
    targetAccountId: "acct-work",
  }),
  accountsConfirmSyncAll: withAccounts([work, home], {
    ...idleSync,
    confirm: { status: "ready", messageCount: 74, windowDays: 90, accountCount: 2 },
    targetAccountId: null,
  }),
  accountsSyncingAll: withAccounts(
    [
      { ...work, syncing: true, syncDetail: "Syncing, 12 of 50" },
      { ...home, syncing: true, syncDetail: "Waiting for its turn" },
    ],
    {
      state: "running",
      progress: {
        stage: "fetching",
        fetched: 12,
        total: null,
        accounts: [
          { accountId: "acct-work", label: "work.shopper@example.com", detail: "12 of 50" },
          { accountId: "acct-home", label: "home@example.com", detail: "waiting" },
        ],
      },
      targetAccountId: null,
      ...syncHandlers,
    },
  ),
  accountsSyncingOne: withAccounts([{ ...work, syncing: true, syncDetail: "Reading 12 of 50" }, home], {
    state: "running",
    progress: { stage: "fetching", fetched: 12, total: 50 },
    targetAccountId: "acct-work",
    ...syncHandlers,
  }),
  /** One account synced, the other needs a reconnect: an error notice that stays until dismissed. */
  accountsPartialFailure: withAccounts([work, expiredRow], {
    ...idleSync,
    notice: {
      tone: "error",
      text: "Synced 1 of 2 accounts",
      detail: "Purchases from the accounts that worked were saved. Reconnect the account that needs it, then sync again.",
      reconnect: true,
      accounts: [
        { accountId: "acct-work", label: "work.shopper@example.com", ok: true, text: "Read 20 emails" },
        { accountId: "acct-home", label: "home@example.com", ok: false, text: "Needs reconnect", reconnect: true },
      ],
    },
  }),
  accountsSyncedAll: withAccounts([work, home], {
    ...idleSync,
    notice: {
      tone: "success",
      text: "Synced 12 purchases",
      accounts: [
        { accountId: "acct-work", label: "work.shopper@example.com", ok: true, text: "Read 20 emails" },
        { accountId: "acct-home", label: "home@example.com", ok: true, text: "Read 8 emails" },
      ],
    },
  }),
  accountsConfirmDisconnect: {
    ...withAccounts([work, home]),
    disconnectStep: "confirm",
    disconnectAccountId: "acct-home",
  },
  accountsDisconnecting: {
    ...withAccounts([work, home]),
    disconnectStep: "pending",
    disconnectAccountId: "acct-home",
  },
} satisfies Record<string, AccountViewProps>;

export const accountViewFixtures = {
  ...accountListFixtures,
  connected,
  connectedNeverSynced: {
    ...connected,
    source: { kind: "empty", label: "No data yet", detail: "Sync your emails, upload files or try the demo data." },
    lastSync: null,
    counts: { purchases: 0, findings: 0, needsCheck: 0 },
    excludedStores: 0,
  },
  connectedMailboxUnknown: { ...connected, gmail: { status: "connected", mailbox: null } },
  syncing: { ...connected, syncing: true },
  confirmingDisconnect: { ...connected, disconnectStep: "confirm" },
  disconnecting: { ...connected, disconnectStep: "pending" },
  disconnectFailed: { ...connected, actionError: "Couldn't disconnect Gmail. Check that the app server is running, then try again." },
  expired: { ...connected, gmail: { status: "expired", mailbox: null } },
  notConnected: {
    ...connected,
    gmail: { status: "not_connected", mailbox: null },
    source: { kind: "empty", label: "No data yet", detail: "Connect Gmail, upload files or try the demo data." },
    lastSync: null,
    counts: { purchases: 0, findings: 0, needsCheck: 0 },
    excludedStores: 0,
  },
  disconnectedWithData: {
    ...connected,
    gmail: { status: "not_connected", mailbox: null },
    source: {
      kind: "gmail_disconnected",
      label: "Gmail disconnected: your synced purchases are kept",
      detail: "Connect Gmail again to read new receipts.",
    },
  },
  demo: {
    ...connected,
    gmail: { status: "not_connected", mailbox: null },
    source: { kind: "demo", label: "Demo data", detail: "Synthetic purchases, not from a real inbox." },
    lastSync: null,
  },
  leavingDemo: {
    ...connected,
    gmail: { status: "not_connected", mailbox: null },
    source: { kind: "demo", label: "Demo data", detail: "Synthetic purchases, not from a real inbox." },
    lastSync: null,
    leaveDemoPending: true,
  },
  upload: {
    ...connected,
    gmail: { status: "not_connected", mailbox: null },
    source: { kind: "upload", label: "Uploaded files", detail: "Purchases imported from .eml or .mbox files." },
    lastSync: null,
  },
} satisfies Record<string, AccountViewProps>;
