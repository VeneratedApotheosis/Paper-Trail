"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SyncView, type SyncErrorInfo, type SyncResultInfo } from "@/components/views/SyncView";
import { useAsync, useGmailSyncStatus } from "@/hooks";
import { runGmailSync } from "@/hooks/syncRun";
import { getGmailPreview, toGmailFailure } from "@/lib/api/client";
import type { GmailFailure, GmailPreviewResponse } from "@/lib/api/types";
import { gmailErrorCopy, gmailProgress, gmailSyncOutcome } from "./syncOutcome";

// /sync with a connected Gmail account (#73): GET /api/gmail/preview, then POST /api/gmail/sync {confirmed:true} only
// after the user clicks Start. The POST runs the whole sync in one request; while it is pending the page polls
// GET /api/gmail/sync/status and shows only those real counts. Success opens "/"; failures keep the prior ledger.

/** The preview request, resolved either way so a failure keeps its HTTP status and `code` (401 token_expired -> reconnect). */
type PreviewResult = { ok: true; data: GmailPreviewResponse } | { ok: false; failure: GmailFailure };

function loadPreview(): Promise<PreviewResult> {
  return getGmailPreview().then(
    (data): PreviewResult => ({ ok: true, data }),
    (caught: unknown): PreviewResult => ({ ok: false, failure: toGmailFailure(caught) }),
  );
}

type Screen =
  | { name: "preview" }
  | { name: "syncing" }
  | { name: "opening"; result: SyncResultInfo }
  | { name: "no_receipts"; result: SyncResultInfo }
  | { name: "failed"; error: SyncErrorInfo };

export function GmailSync() {
  const router = useRouter();
  const preview = useAsync(loadPreview, []);
  const [screen, setScreen] = useState<Screen>({ name: "preview" });
  const inFlight = useRef(false);
  const status = useGmailSyncStatus(screen.name === "syncing");
  const previewData = preview.data?.ok ? preview.data.data : null;

  async function startSync() {
    if (inFlight.current) return;
    inFlight.current = true;
    setScreen({ name: "syncing" });
    try {
      // runGmailSync refreshes every cached read afterwards, even after a failed or partial sync, and lets the
      // header "Sync emails" button know a sync is running.
      const response = await runGmailSync();
      const outcome = gmailSyncOutcome(response, previewData?.maxMessages ?? null);
      if (outcome.kind === "open_ledger") {
        setScreen({ name: "opening", result: outcome.result });
        router.push("/");
      } else {
        setScreen({ name: "no_receipts", result: outcome.result });
      }
    } catch (caught: unknown) {
      setScreen({ name: "failed", error: gmailErrorCopy(toGmailFailure(caught), "sync") });
    } finally {
      inFlight.current = false;
    }
  }

  function backToPreview() {
    setScreen({ name: "preview" });
    preview.refetch();
  }

  function phaseProps() {
    if (screen.name === "syncing") return { phase: "syncing", progress: gmailProgress(status) } as const;
    if (screen.name === "opening") return { phase: "opening", result: screen.result } as const;
    if (screen.name === "no_receipts") return { phase: "no_receipts", result: screen.result } as const;
    if (screen.name === "failed") return { phase: "error", error: screen.error } as const;
    if (preview.loading) return { phase: "loading" } as const;
    if (preview.error || !preview.data) {
      return {
        phase: "error",
        error: gmailErrorCopy({ status: 0, code: null, error: preview.error }, "preview"),
      } as const;
    }
    if (!preview.data.ok) return { phase: "error", error: gmailErrorCopy(preview.data.failure, "preview") } as const;
    return { phase: "preview" } as const;
  }

  return (
    <SyncView
      mode="gmail"
      preview={previewData}
      {...phaseProps()}
      onStart={() => void startSync()}
      onRetry={backToPreview}
      onOpenLedger={() => router.push("/")}
      onOpenReview={() => router.push("/review")}
      onReconnect={() => router.push("/connect")}
    />
  );
}
