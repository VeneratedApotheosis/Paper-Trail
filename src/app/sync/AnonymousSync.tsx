"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, HeroSkeleton } from "@/components/states";
import { Button, LinkButton } from "@/components/ui/Button";
import { useAction, useAsync, useLoadDemo } from "@/hooks";
import { getPrefilter, uploadFiles } from "@/lib/api/client";
import { plural, uploadOutcome } from "./syncOutcome";

// /sync without a Gmail connection (#73): shows the real prefilter (GET /api/prefilter), imports .eml/.mbox files
// (POST /api/upload) or loads the synthetic demo (POST /api/demo) on an explicit click, then opens "/".

type Screen =
  | { name: "preview" }
  | { name: "opening" }
  | { name: "no_receipts"; detail: string }
  | { name: "upload_failed" }
  | { name: "demo_failed" };

/** Opens the browser's file picker without rendering a file input; resolves with the chosen files. */
function pickReceiptFiles(onPicked: (files: File[]) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".eml,.mbox,message/rfc822";
  input.multiple = true;
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    if (files.length > 0) onPicked(files);
  });
  input.click();
}

export function AnonymousSync() {
  const router = useRouter();
  const prefilter = useAsync(() => getPrefilter(), []);
  const upload = useAction(uploadFiles);
  const demo = useLoadDemo();
  const [screen, setScreen] = useState<Screen>({ name: "preview" });
  const [uploadCount, setUploadCount] = useState(0);

  function openLedger() {
    setScreen({ name: "opening" });
    router.push("/");
  }

  async function importFiles(files: File[]) {
    setUploadCount(files.length);
    const response = await upload.run(files);
    if (!response) {
      setScreen({ name: "upload_failed" });
      return;
    }
    const outcome = uploadOutcome(response);
    if (outcome.kind === "open_ledger") openLedger();
    else setScreen({ name: "no_receipts", detail: outcome.detail });
  }

  function chooseFiles() {
    pickReceiptFiles((files) => void importFiles(files));
  }

  async function tryDemo() {
    if (await demo.run()) openLedger();
    else setScreen({ name: "demo_failed" });
  }

  const busy = upload.pending || demo.pending;
  const actions = (
    <>
      <Button type="button" onClick={chooseFiles} disabled={busy}>
        Import .eml / .mbox
      </Button>
      <Button type="button" variant="secondary" onClick={tryDemo} disabled={busy}>
        Try demo data
      </Button>
    </>
  );

  function content() {
    if (upload.pending) {
      return (
        <EmptyState title="Importing your files…">
          Reading {plural(uploadCount, "file")}. Each email is redacted before any AI call.
        </EmptyState>
      );
    }
    if (demo.pending) return <EmptyState title="Loading the synthetic demo inbox…" />;
    if (screen.name === "opening") return <EmptyState title="Opening what you're owed…" />;
    if (screen.name === "no_receipts") {
      return (
        <EmptyState title="No receipts found in these files" actions={actions}>
          {screen.detail}
        </EmptyState>
      );
    }
    if (screen.name === "upload_failed" || screen.name === "demo_failed") {
      const uploadFailed = screen.name === "upload_failed";
      return (
        <ErrorState
          title={uploadFailed ? "Couldn't import those files" : "Couldn't load the demo data"}
          what={uploadFailed ? upload.error : demo.error}
          fix={
            uploadFailed
              ? "Choose .eml or .mbox files, 5 MB in total at most."
              : "Check that the app server is running, then try again."
          }
          actions={actions}
        />
      );
    }
    if (prefilter.loading) return <HeroSkeleton />;
    if (prefilter.error || !prefilter.data) {
      return (
        <ErrorState
          title="Couldn't load the sync preview"
          what={prefilter.error}
          fix="Check that the app server is running, then try again."
          actions={
            <Button type="button" onClick={prefilter.refetch}>
              Try again
            </Button>
          }
        />
      );
    }
    return (
      <EmptyState
        title="Import receipts or try the demo"
        actions={
          <>
            {actions}
            <LinkButton href="/connect" variant="ghost">
              Connect Gmail
            </LinkButton>
          </>
        }
      >
        Gmail is not connected. {prefilter.data.description} Without Gmail, import receipt emails as .eml or .mbox
        files, or load the synthetic demo inbox.
      </EmptyState>
    );
  }

  return <AppShell>{content()}</AppShell>;
}
