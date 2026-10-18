"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SyncView, type SyncResultInfo } from "@/components/views/SyncView";
import { useAction, useAsync, useLoadDemo } from "@/hooks";
import { getPrefilter, uploadFiles } from "@/lib/api/client";
import { importErrorCopy, uploadOutcome } from "./syncOutcome";

// /sync without a Gmail connection (#73): shows the real prefilter (GET /api/prefilter), imports .eml/.mbox files
// (POST /api/upload) or loads the synthetic demo (POST /api/demo) on an explicit click, then opens "/".

type Screen =
  | { name: "preview" }
  | { name: "opening"; result: SyncResultInfo | null }
  | { name: "no_receipts"; result: SyncResultInfo }
  | { name: "failed"; during: "upload" | "demo" };

/** Import mode has no Start button (SyncView renders it only for Gmail); every run starts from Import or the demo. */
function noGmailStart() {}

export function AnonymousSync() {
  const router = useRouter();
  const prefilter = useAsync(() => getPrefilter(), []);
  const upload = useAction(uploadFiles);
  const demo = useLoadDemo();
  const [screen, setScreen] = useState<Screen>({ name: "preview" });

  function openLedger(result: SyncResultInfo | null) {
    setScreen({ name: "opening", result });
    router.push("/");
  }

  async function importFiles(fileList: FileList) {
    // Copy now: the view clears its file input right after this call.
    const files = Array.from(fileList);
    const response = await upload.run(files);
    if (!response) {
      setScreen({ name: "failed", during: "upload" });
      return;
    }
    const outcome = uploadOutcome(response);
    if (outcome.kind === "open_ledger") openLedger(outcome.result);
    else setScreen({ name: "no_receipts", result: outcome.result });
  }

  async function tryDemo() {
    if (await demo.run()) openLedger(null);
    else setScreen({ name: "failed", during: "demo" });
  }

  function retry() {
    setScreen({ name: "preview" });
    if (prefilter.error) prefilter.refetch();
  }

  const preview = prefilter.data
    ? { query: prefilter.data.query, windowDays: prefilter.data.windowDays, redaction: prefilter.data.redaction }
    : null;

  function phaseProps() {
    if (upload.pending) return { phase: "uploading" } as const;
    if (demo.pending) return { phase: "loading_demo" } as const;
    if (screen.name === "opening") return { phase: "opening", result: screen.result } as const;
    if (screen.name === "no_receipts") return { phase: "no_receipts", result: screen.result } as const;
    if (screen.name === "failed") {
      const message = screen.during === "upload" ? upload.error : demo.error;
      return { phase: "error", error: importErrorCopy(screen.during, message) } as const;
    }
    if (prefilter.loading) return { phase: "loading" } as const;
    if (prefilter.error || !prefilter.data) {
      return { phase: "error", error: importErrorCopy("preview", prefilter.error) } as const;
    }
    return { phase: "preview" } as const;
  }

  return (
    <SyncView
      mode="import"
      preview={preview}
      {...phaseProps()}
      onStart={noGmailStart}
      onUpload={(files) => void importFiles(files)}
      onTryDemo={() => void tryDemo()}
      onRetry={retry}
      onOpenLedger={() => router.push("/")}
      onOpenReview={() => router.push("/review")}
    />
  );
}
