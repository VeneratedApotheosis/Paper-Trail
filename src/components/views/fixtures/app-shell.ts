import { createElement } from "react";
import type { AppShellSync, AppShellViewProps } from "@/components/views/AppShellView";

// Sample props for previewing AppShellView in isolation. Standalone synthetic
// data (not from @/lib/mock) so the view stays decoupled from the data layer.
export const appShellViewFixture: AppShellViewProps = {
  activePath: "/ledger",
  mode: "demo",
  demoLabel: "Demo data: synthetic",
  precomputedExtractionLabel: "Extracted from precomputed seed labels (no LLM call)",
  onLeaveDemo: () => {},
  nav: [
    { href: "/", label: "Owed to you" },
    { href: "/ledger", label: "Purchases" },
    { href: "/promotions", label: "Promotions" },
    { href: "/review", label: "Review" },
    { href: "/trust", label: "Trust" },
    { href: "/account", label: "Account" },
  ],
  account: {
    initials: "SR",
    name: "Sample account",
    sublabel: "Demo data",
  },
  children: createElement("div", { className: "neu-inset rounded-lg p-6 text-ink" }, "Page content goes here"),
};

const noop = () => {};
const syncHandlers = { onSync: noop, onConnect: noop, onStartSync: noop, onCancelSync: noop, onDismissNotice: noop };

// Every state of the header "Sync emails" button (issue #112), for previews and tests.
export const appShellSyncFixtures = {
  checking: { state: "checking", ...syncHandlers },
  ready: { state: "ready", lastSyncLabel: "Last synced 5 minutes ago", ...syncHandlers },
  neverSynced: { state: "ready", lastSyncLabel: "Not synced yet", ...syncHandlers },
  confirming: {
    state: "ready",
    lastSyncLabel: "Last synced 5 minutes ago",
    confirm: { status: "ready", messageCount: 50, windowDays: 90 },
    ...syncHandlers,
  },
  confirmLoading: { state: "ready", confirm: { status: "loading" }, ...syncHandlers },
  running: { state: "running", progress: null, ...syncHandlers },
  runningFetching: { state: "running", progress: { stage: "fetching", fetched: 12, total: 50 }, ...syncHandlers },
  runningProcessing: { state: "running", progress: { stage: "processing", fetched: 50, total: 50 }, ...syncHandlers },
  connect: { state: "connect", ...syncHandlers },
  reconnect: { state: "reconnect", lastSyncLabel: "Last synced 3 days ago", ...syncHandlers },
  success: { state: "ready", notice: { tone: "success", text: "Synced 12 purchases" }, ...syncHandlers },
  // Several Gmail accounts (issue #115): confirm across accounts, a line per account while syncing, a per-account result.
  confirmingTwoAccounts: {
    state: "ready",
    confirm: { status: "ready", messageCount: 74, windowDays: 90, accountCount: 2 },
    targetAccountId: null,
    ...syncHandlers,
  },
  runningTwoAccounts: {
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
    ...syncHandlers,
  },
  partialFailure: {
    state: "ready",
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
    ...syncHandlers,
  },
  alreadyRunning: {
    state: "running",
    notice: { tone: "error", text: "A Gmail sync is already running", detail: "Wait for it to finish." },
    ...syncHandlers,
  },
  expired: {
    state: "reconnect",
    notice: {
      tone: "error",
      text: "Your Gmail connection expired",
      detail: "PaperTrail needs read-only permission again before it can sync.",
      reconnect: true,
    },
    ...syncHandlers,
  },
} satisfies Record<string, AppShellSync>;