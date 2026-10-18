import type { AccountViewProps } from "@/components/views/AccountView";

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

export const accountViewFixtures = {
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
