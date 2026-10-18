import type { SyncViewProps } from "@/components/views/SyncView";

// Sample props for previewing SyncView in isolation, one per phase. Standalone synthetic data (not from @/lib/mock)
// so the view stays decoupled from the data layer. Callbacks are no-ops.
const noop = () => {};

const callbacks = {
  onStart: noop,
  onRetry: noop,
  onOpenLedger: noop,
  onReconnect: noop,
} satisfies Pick<SyncViewProps, "onStart" | "onRetry" | "onOpenLedger" | "onReconnect">;

const importCallbacks = {
  ...callbacks,
  onUpload: noop,
  onTryDemo: noop,
} satisfies Pick<SyncViewProps, "onStart" | "onRetry" | "onOpenLedger" | "onUpload" | "onTryDemo">;

const sampleQuery = "newer_than:90d (subject:(order OR receipt OR refund) OR from:(orders OR receipts))";

const gmailPreview = {
  query: sampleQuery,
  windowDays: 90,
  estimatedMessages: 120,
  messagesToFetch: 50,
  maxMessages: 50,
  countIsEstimate: true,
} satisfies SyncViewProps["preview"];

const importPreview = {
  query: sampleQuery,
  description:
    "PaperTrail only asks Gmail for messages from the last 90 days whose subject mentions an order, receipt, or refund. Everything else in your inbox is never fetched.",
  windowDays: 90,
} satisfies SyncViewProps["preview"];

const gmail = { mode: "gmail", preview: gmailPreview, ...callbacks } as const;
const imported = { mode: "import", preview: importPreview, ...importCallbacks } as const;

export const syncViewLoadingFixture: SyncViewProps = { ...gmail, preview: null, phase: "loading" };

export const syncViewGmailPreviewFixture: SyncViewProps = { ...gmail, phase: "preview" };

export const syncViewImportPreviewFixture: SyncViewProps = { ...imported, phase: "preview" };

/** Default preview fixture, with the dev toggle on for design review. */
export const syncViewFixture: SyncViewProps = { ...gmail, phase: "preview", showDevToggle: true };

export const syncViewSyncingStartFixture: SyncViewProps = { ...gmail, phase: "syncing", progress: null };

export const syncViewSyncingListingFixture: SyncViewProps = {
  ...gmail,
  phase: "syncing",
  progress: { stage: "listing", fetched: 0, total: null, skipped: 0 },
};

export const syncViewSyncingFetchingFixture: SyncViewProps = {
  ...gmail,
  phase: "syncing",
  progress: { stage: "fetching", fetched: 21, total: 50, skipped: 1 },
};

export const syncViewSyncingProcessingFixture: SyncViewProps = {
  ...gmail,
  phase: "syncing",
  progress: { stage: "processing", fetched: 50, total: 50, skipped: 1 },
};

export const syncViewUploadingFixture: SyncViewProps = { ...imported, phase: "uploading" };

export const syncViewLoadingDemoFixture: SyncViewProps = { ...imported, phase: "loading_demo" };

export const syncViewGmailResultFixture: SyncViewProps = {
  ...gmail,
  phase: "opening",
  result: { scanned: 50, parseErrors: 1, capped: true, maxMessages: 50, orders: 9, needsReview: 2, findings: 3 },
};

export const syncViewImportResultFixture: SyncViewProps = {
  ...imported,
  phase: "opening",
  result: { scanned: 2, files: 2, parseErrors: 0, orders: 1, needsReview: 0, findings: 1 },
};

export const syncViewGmailNoReceiptsFixture: SyncViewProps = {
  ...gmail,
  phase: "no_receipts",
  result: { scanned: 12, parseErrors: 0, capped: false, maxMessages: 50, orders: 0, needsReview: 0, findings: 0 },
};

export const syncViewImportNoReceiptsFixture: SyncViewProps = {
  ...imported,
  phase: "no_receipts",
  result: { scanned: 3, files: 2, parseErrors: 1, orders: 0, needsReview: 0, findings: 0 },
};

function gmailError(error: NonNullable<SyncViewProps["error"]>): SyncViewProps {
  return { ...gmail, phase: "error", error };
}

export const syncViewErrorFixtures = {
  reconnect: gmailError({
    kind: "reconnect",
    title: "Your Gmail connection expired",
    what: "PaperTrail needs read-only permission again before it can sync.",
    fix: "Reconnect Gmail, then start the sync again.",
  }),
  already_running: gmailError({
    kind: "already_running",
    title: "A Gmail sync is already running",
    what: "Another sync for this account is still in progress, so this one did not start.",
    fix: "Wait for it to finish, then open what you're owed.",
  }),
  timeout: gmailError({
    kind: "timeout",
    title: "Gmail sync took too long",
    what: "The sync stopped at its time limit before it finished. Your previous ledger is unchanged.",
    fix: "Try again in a moment.",
  }),
  rate_limited: gmailError({
    kind: "rate_limited",
    title: "Gmail is limiting requests",
    what: "Gmail asked PaperTrail to slow down. Your previous ledger is unchanged.",
    fix: "Wait a minute, then try again.",
  }),
  access_denied: gmailError({
    kind: "access_denied",
    title: "Gmail denied access",
    what: "Gmail refused the read-only request.",
    fix: "Reconnect Gmail and allow read-only access, then try again.",
  }),
  unreachable: gmailError({
    kind: "unreachable",
    title: "Couldn't reach PaperTrail",
    what: "The connection dropped before the sync answered. It may still be running on the server.",
    fix: "Check that the app server is running, then try again.",
  }),
  failed: gmailError({
    kind: "failed",
    title: "Gmail sync did not complete",
    what: "Receipt extraction is unavailable right now. Your previous ledger is unchanged.",
    fix: "Try again. If it keeps failing, check the server configuration.",
  }),
  import_failed: {
    ...imported,
    phase: "error",
    error: {
      kind: "failed",
      title: "Couldn't import those files",
      what: "No .eml or .mbox files were uploaded.",
      fix: "Choose .eml or .mbox files, 5 MB in total at most.",
    },
  },
} satisfies Record<string, SyncViewProps>;
