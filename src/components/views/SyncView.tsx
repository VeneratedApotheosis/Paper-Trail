"use client";

import { useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { SyncPreview, UploadButton, type SyncMode, type SyncPreviewInfo } from "@/components/SyncPreview";
import { SyncProgress, type SyncProgressInfo } from "@/components/SyncProgress";
import { SyncNoReceipts, SyncResult, type SyncResultInfo } from "@/components/SyncResult";
import { SyncLayout, SyncRail, errorChip, errorIntro, insetTile, mainCard, stepStates } from "@/components/SyncRail";
import { EmptyState, HeroSkeleton } from "@/components/states";
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
  /** Optional raw reason from the server, shown under "Technical details" when present. */
  detail?: string;
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
  /** "Review the N items" on the result screen; omit to hide it. */
  onOpenReview?: () => void;
  /** Design/dev only: a checkbox that swaps in the no-receipts screen. The app never sets it. */
  showDevToggle?: boolean;
}

export function SyncView(props: SyncViewProps) {
  const { mode, showDevToggle = false } = props;
  const [devNoReceipts, setDevNoReceipts] = useState(false);
  const phase = showDevToggle && devNoReceipts ? "no_receipts" : props.phase;

  return (
    <AppShell demo={mode === "gmail" ? false : undefined}>
      {/* data-layout="wide" lets the shell use the full desktop width (#133); below xl it is one column. */}
      <div data-layout="wide" className="mx-auto max-w-ledger space-y-6 xl:max-w-none">
        <SyncPhaseContent {...props} phase={phase} result={showDevToggle && devNoReceipts ? null : props.result} />
        {showDevToggle ? (
          <label className="neu-inset mx-auto flex min-h-[44px] max-w-ledger items-center gap-3 rounded-lg px-4 py-3 text-sm text-ink-muted">
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
  onOpenReview,
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
      return (
        <SyncProgress
          progress={progress}
          maxMessages={preview?.maxMessages}
          windowDays={preview?.windowDays}
          redactionOff={preview?.redaction === "off"}
        />
      );
    case "uploading":
      return <EmptyState title="Importing your files…">
          {preview?.redaction === "off" ? "Receipt text is sent to the AI as is (redaction is off)." : "Each email is redacted before any AI call."}
        </EmptyState>;
    case "loading_demo":
      return <EmptyState title="Loading the synthetic demo inbox…" />;
    case "opening":
      return result ? (
        <SyncResult mode={mode} result={result} onOpenLedger={onOpenLedger} onOpenReview={onOpenReview} windowDays={preview?.windowDays} />
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
        <SyncErrorScreen
          mode={mode}
          error={error}
          preview={preview}
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

const pill = "!min-h-[48px] !rounded-full";

// The failure screen: what happened, how to fix it, and one clear next step. `detail` (technical details) shows only
// when the wrapper has a real reason to show.
function SyncErrorScreen({
  mode,
  error,
  preview,
  actions,
}: {
  mode: SyncMode;
  error: SyncErrorInfo | null;
  preview: SyncPreviewInfo | null;
  actions: ReactNode;
}) {
  const kind = error?.kind ?? "failed";
  const gmail = mode === "gmail";
  return (
    <SyncLayout
      mode={mode}
      title={gmail ? "Sync stopped" : "Import stopped"}
      intro={gmail ? errorIntro(kind) : "The import did not finish."}
      rail={
        <SyncRail
          states={stepStates("error")}
          windowDays={preview?.windowDays}
          maxMessages={gmail ? preview?.maxMessages : undefined}
          redactionOff={preview?.redaction === "off"}
          stepsOnPhone={false}
        />
      }
    >
      <section role="alert" className={mainCard}>
        <div className="flex flex-col items-start gap-3">
          <span className="neu-inset inline-flex h-6 items-center rounded-full px-3 text-[0.6875rem] font-semibold text-ink-muted">
            {errorChip(kind)}
          </span>
          <h2 className="font-serif text-[1.625rem] leading-8 tracking-[-0.01em] text-ink xl:text-[2.5rem] xl:leading-[3rem]">
            {error?.title ?? "Sync did not complete"}
          </h2>
        </div>
        <div className="flex flex-col gap-3 xl:flex-row xl:gap-4">
          {error?.what ? (
            <div className={`${insetTile} flex flex-1 flex-col gap-1.5`}>
              <p className="text-sm font-bold text-teal-deep">What happened</p>
              <p className="text-sm text-ink xl:text-base">{error.what}</p>
            </div>
          ) : null}
          <div className={`${insetTile} flex flex-1 flex-col gap-1.5`}>
            <p className="text-sm font-bold text-teal-deep">How to fix it</p>
            <p className="text-sm text-ink xl:text-base">{error?.fix ?? "Try again."}</p>
          </div>
        </div>
        {error?.detail ? (
          <div className="flex flex-col gap-2">
            <p className="eyebrow">Technical details</p>
            <code className="block break-words font-mono text-[0.75rem] leading-5 text-ink">{error.detail}</code>
          </div>
        ) : null}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-4">{actions}</div>
      </section>

      <section aria-label="Safe to try again" className="neu-raised hidden flex-col gap-1 rounded-lg p-6 xl:flex">
        <h2 className="pb-2 font-serif text-xl text-ink">Safe to try again</h2>
        <dl>
          <div className="flex items-center gap-4 border-t border-rule py-3.5">
            <dt className="w-[7.5rem] shrink-0 text-sm font-bold text-ink">Your inbox</dt>
            <dd className="text-sm text-ink-muted">Nothing was changed or deleted. PaperTrail only reads.</dd>
          </div>
          <div className="flex items-center gap-4 border-t border-rule pt-3.5">
            <dt className="w-[7.5rem] shrink-0 text-sm font-bold text-ink">Your account</dt>
            <dd className="text-sm text-ink-muted">Nothing was sent. PaperTrail never sends email.</dd>
          </div>
        </dl>
      </section>
    </SyncLayout>
  );
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
    <Button type="button" className={pill} onClick={onReconnect}>
      Reconnect Gmail
    </Button>
  ) : null;

  if (kind === "reconnect") {
    return (
      <>
        {reconnect}
        <Button type="button" variant="secondary" className={pill} onClick={onRetry}>
          Back to the preview
        </Button>
      </>
    );
  }
  if (kind === "access_denied") {
    return (
      <>
        {reconnect}
        <Button type="button" variant="secondary" className={pill} onClick={onRetry}>
          Try again
        </Button>
      </>
    );
  }
  if (kind === "already_running") {
    return (
      <>
        <Button type="button" className={pill} onClick={onOpenLedger}>
          Open Owed to you
        </Button>
        <Button type="button" variant="secondary" className={pill} onClick={onRetry}>
          Back to the preview
        </Button>
      </>
    );
  }
  if (mode === "import" && hasPreview && (onUpload || onTryDemo)) {
    return (
      <>
        {onUpload ? <UploadButton onUpload={onUpload} /> : null}
        {onTryDemo ? (
          <Button type="button" variant="secondary" className={pill} onClick={onTryDemo}>
            Try demo data
          </Button>
        ) : null}
      </>
    );
  }
  return (
    <Button type="button" className={pill} onClick={onRetry}>
      Try again
    </Button>
  );
}
