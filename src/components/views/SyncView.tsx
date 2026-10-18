"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { SyncPreview, UploadButton, type SyncMode, type SyncPreviewInfo } from "@/components/SyncPreview";
import { SyncProgress, type SyncProgressInfo } from "@/components/SyncProgress";
import { SyncNoReceipts, SyncResult, type SyncResultInfo } from "@/components/SyncResult";
import { EmptyState, ErrorState, HeroSkeleton } from "@/components/states";
import { Button } from "@/components/ui/Button";

export type { SyncMode, SyncPreviewInfo, SyncProgressInfo, SyncResultInfo };

export type SyncPhase =
  | "loading"
  | "preview"
  | "syncing"
  | "uploading"
  | "loading_demo"
  | "opening"
  | "no_receipts"
  | "error";

export type SyncErrorKind =
  | "reconnect"
  | "already_running"
  | "timeout"
  | "rate_limited"
  | "access_denied"
  | "unreachable"
  | "failed";

export interface SyncErrorInfo {
  kind: SyncErrorKind;
  title: string;
  what: string;
  fix: string;
}

// Props-only view for /sync (issue #25, real data per #101). Fully controlled: the wrapper owns the phase, the preview
// numbers, live progress, the result counts, and every action (no fetch, no @/lib/api|store|mock|auth, no routing).
// `mode` "gmail" syncs a connected inbox; "import" takes .eml/.mbox files or the synthetic demo.
// Import and "Try demo data" render only in import mode and only when their callback is given.
export interface SyncViewProps {
  mode: SyncMode;
  preview: SyncPreviewInfo | null;
  phase: SyncPhase;
  progress?: SyncProgressInfo | null;
  result?: SyncResultInfo | null;
  error?: SyncErrorInfo | null;
  onStart: () => void;
  onUpload?: (files: FileList) => void;
  onTryDemo?: () => void;
  onRetry: () => void;
  onOpenLedger: () => void;
  onReconnect?: () => void;
  /** Design/dev only: a checkbox that swaps in the no-receipts screen. The app never sets it. */
  showDevToggle?: boolean;
}

export function SyncView(props: SyncViewProps) {
  const { mode, showDevToggle = false } = props;
  const [devNoReceipts, setDevNoReceipts] = useState(false);
  const phase = showDevToggle && devNoReceipts ? "no_receipts" : props.phase;

  return (
    <AppShell demo={mode === "gmail" ? false : undefined}>
      <div className="space-y-6">
        <SyncPhaseContent {...props} phase={phase} result={showDevToggle && devNoReceipts ? null : props.result} />
        {showDevToggle ? (
          <label className="neu-inset mx-auto flex max-w-ledger items-center gap-3 rounded-lg px-4 py-3 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={devNoReceipts}
              onChange={(event) => setDevNoReceipts(event.target.checked)}
              className="h-4 w-4 rounded-sm accent-teal"
            />
            <span>
              <span className="font-semibold text-ink">Dev:</span> show the no-receipts screen
            </span>
          </label>
        ) : null}
      </div>
    </AppShell>
  );
}

function SyncPhaseContent({
  mode,
  preview,
  phase,
  progress = null,
  result = null,
  error = null,
  onStart,
  onUpload,
  onTryDemo,
  onRetry,
  onOpenLedger,
  onReconnect,
}: SyncViewProps) {
  switch (phase) {
    case "loading":
      return <HeroSkeleton />;
    case "preview":
      return preview ? (
        <SyncPreview mode={mode} preview={preview} onStart={onStart} onUpload={onUpload} onTryDemo={onTryDemo} />
      ) : (
        <HeroSkeleton />
      );
    case "syncing":
      return <SyncProgress progress={progress} />;
    case "uploading":
      return <EmptyState title="Importing your files…">Each email is redacted before any AI call.</EmptyState>;
    case "loading_demo":
      return <EmptyState title="Loading the synthetic demo inbox…" />;
    case "opening":
      return result ? (
        <SyncResult mode={mode} result={result} onOpenLedger={onOpenLedger} />
      ) : (
        <EmptyState title="Opening what you're owed…" />
      );
    case "no_receipts":
      return (
        <SyncNoReceipts
          mode={mode}
          result={result}
          query={preview?.query}
          onRetry={onRetry}
          onUpload={onUpload}
          onTryDemo={onTryDemo}
        />
      );
    case "error":
      return (
        <ErrorState
          title={error?.title ?? "Sync did not complete"}
          what={error?.what}
          fix={error?.fix ?? "Try again."}
          actions={
            <SyncErrorActions
              mode={mode}
              kind={error?.kind ?? "failed"}
              hasPreview={preview !== null}
              onUpload={onUpload}
              onTryDemo={onTryDemo}
              onRetry={onRetry}
              onOpenLedger={onOpenLedger}
              onReconnect={onReconnect}
            />
          }
        />
      );
  }
}

// One clear next step per failure: reconnect for an expired or denied grant, open the ledger when another sync is
// already running, otherwise try again. A failed import or demo load keeps the loaded preview, so it offers the import
// actions directly; without a preview (it failed to load) "Try again" reloads it.
function SyncErrorActions({
  mode,
  kind,
  hasPreview,
  onUpload,
  onTryDemo,
  onRetry,
  onOpenLedger,
  onReconnect,
}: {
  mode: SyncMode;
  kind: SyncErrorKind;
  hasPreview: boolean;
} & Pick<SyncViewProps, "onUpload" | "onTryDemo" | "onRetry" | "onOpenLedger" | "onReconnect">) {
  const reconnect = onReconnect ? (
    <Button type="button" onClick={onReconnect}>
      Reconnect Gmail
    </Button>
  ) : null;

  if (kind === "reconnect") return reconnect;
  if (kind === "access_denied") {
    return (
      <>
        {reconnect}
        <Button type="button" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </>
    );
  }
  if (kind === "already_running") {
    return (
      <>
        <Button type="button" onClick={onOpenLedger}>
          Open what you&apos;re owed
        </Button>
        <Button type="button" variant="secondary" onClick={onRetry}>
          Back to sync
        </Button>
      </>
    );
  }
  if (mode === "import" && hasPreview && (onUpload || onTryDemo)) {
    return (
      <>
        {onUpload ? <UploadButton onUpload={onUpload} /> : null}
        {onTryDemo ? (
          <Button type="button" variant="secondary" onClick={onTryDemo}>
            Try demo data
          </Button>
        ) : null}
      </>
    );
  }
  return (
    <Button type="button" onClick={onRetry}>
      Try again
    </Button>
  );
}
