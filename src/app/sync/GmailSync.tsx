"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SyncView, type SyncErrorInfo, type SyncResultInfo } from "@/components/views/SyncView";
import { useAsync } from "@/hooks";
import { getGmailPreview, getGmailSyncStatus, syncGmail, type GmailSyncStatus } from "./gmailApi";
import { gmailErrorCopy, gmailProgress, gmailSyncOutcome } from "./syncOutcome";

// /sync with a connected Gmail account (#73): GET /api/gmail/preview, then POST /api/gmail/sync {confirmed:true} only
// after the user clicks Start. The POST runs the whole sync in one request; while it is pending the page polls
// GET /api/gmail/sync/status and shows only those real counts. Success opens "/"; failures keep the prior ledger.

const STATUS_POLL_MS = 1000;

type Screen =
  | { name: "preview" }
  | { name: "syncing" }
  | { name: "opening"; result: SyncResultInfo }
  | { name: "no_receipts"; result: SyncResultInfo }
  | { name: "failed"; error: SyncErrorInfo };

export function GmailSync() {
  const router = useRouter();
  const preview = useAsync(() => getGmailPreview(), []);
  const [screen, setScreen] = useState<Screen>({ name: "preview" });
  const [status, setStatus] = useState<GmailSyncStatus | null>(null);
  const inFlight = useRef(false);
  const syncing = screen.name === "syncing";

  useEffect(() => {
    if (!syncing) return;
    let active = true;
    const timer = setInterval(() => {
      void getGmailSyncStatus().then((result) => {
        if (active && result.ok) setStatus(result.data);
      });
    }, STATUS_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [syncing]);

  const previewData = preview.data?.ok ? preview.data.data : null;

  async function startSync() {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus(null);
    setScreen({ name: "syncing" });
    try {
      const result = await syncGmail();
      if (!result.ok) {
        setScreen({ name: "failed", error: gmailErrorCopy(result.failure, "sync") });
        return;
      }
      const outcome = gmailSyncOutcome(result.data, previewData?.maxMessages ?? null);
      if (outcome.kind === "open_ledger") {
        setScreen({ name: "opening", result: outcome.result });
        router.push("/");
      } else {
        setScreen({ name: "no_receipts", result: outcome.result });
      }
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
      onReconnect={() => router.push("/connect")}
    />
  );
}
