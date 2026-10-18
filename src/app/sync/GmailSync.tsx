"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, HeroSkeleton, TokenExpired } from "@/components/states";
import { Button, LinkButton } from "@/components/ui/Button";
import { useAsync } from "@/hooks";
import { getGmailPreview, getGmailSyncStatus, syncGmail, type GmailSyncStatus } from "./gmailApi";
import {
  gmailErrorCopy,
  gmailPreviewText,
  gmailProgressText,
  gmailSyncOutcome,
  type SyncErrorCopy,
} from "./syncOutcome";

// /sync with a connected Gmail account (#73): GET /api/gmail/preview, then POST /api/gmail/sync {confirmed:true} only
// after the user clicks Start. The POST runs the whole sync in one request; while it is pending the page polls
// GET /api/gmail/sync/status and shows only those real counts. Success opens "/"; failures keep the prior ledger.

const STATUS_POLL_MS = 1000;

type Screen =
  | { name: "preview" }
  | { name: "syncing" }
  | { name: "opening" }
  | { name: "no_receipts"; detail: string }
  | { name: "failed"; error: SyncErrorCopy };

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

  const maxMessages = preview.data?.ok ? preview.data.data.maxMessages : null;
  const query = preview.data?.ok ? preview.data.data.query : undefined;

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
      const outcome = gmailSyncOutcome(result.data, maxMessages);
      if (outcome.kind === "open_ledger") {
        setScreen({ name: "opening" });
        router.push("/");
      } else {
        setScreen({ name: "no_receipts", detail: outcome.detail });
      }
    } finally {
      inFlight.current = false;
    }
  }

  function backToPreview() {
    setScreen({ name: "preview" });
    preview.refetch();
  }

  function errorScreen(error: SyncErrorCopy) {
    if (error.kind === "reconnect") return <TokenExpired />;
    const actions =
      error.kind === "access_denied" ? (
        <LinkButton href="/connect">Reconnect Gmail</LinkButton>
      ) : error.kind === "already_running" ? (
        <>
          <Button type="button" onClick={() => router.push("/")}>
            Open what you&apos;re owed
          </Button>
          <Button type="button" variant="secondary" onClick={backToPreview}>
            Back to sync
          </Button>
        </>
      ) : (
        <Button type="button" onClick={backToPreview}>
          Try again
        </Button>
      );
    return <ErrorState title={error.title} what={error.what} fix={error.fix} actions={actions} />;
  }

  function content() {
    if (screen.name === "syncing") {
      return (
        <EmptyState title="Syncing your Gmail receipts">
          {gmailProgressText(status)} Read only. This can take a few minutes; keep this tab open.
        </EmptyState>
      );
    }
    if (screen.name === "opening") return <EmptyState title="Opening what you're owed…" />;
    if (screen.name === "failed") return errorScreen(screen.error);
    if (screen.name === "no_receipts") {
      return (
        <EmptyState
          title="No receipts found in this inbox"
          query={query}
          actions={
            <Button type="button" variant="secondary" onClick={backToPreview}>
              Back to sync
            </Button>
          }
        >
          {screen.detail}
        </EmptyState>
      );
    }
    if (preview.loading) return <HeroSkeleton />;
    if (preview.error || !preview.data) {
      return errorScreen(gmailErrorCopy({ status: 0, code: null, error: preview.error }, "preview"));
    }
    if (!preview.data.ok) return errorScreen(gmailErrorCopy(preview.data.failure, "preview"));
    return (
      <EmptyState
        title="Check your inbox for new receipts"
        actions={
          <Button type="button" onClick={startSync}>
            Start sync
          </Button>
        }
      >
        {gmailPreviewText(preview.data.data)}
      </EmptyState>
    );
  }

  return <AppShell demo={false}>{content()}</AppShell>;
}
