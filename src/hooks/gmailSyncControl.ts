"use client";

// Wires the "Sync emails" controls (header issue #112, Account page #115) to the account, the Gmail routes and the
// shared cache. Click -> real preview (GET /api/gmail/preview, for one account or all) in an inline confirm -> Start
// runs POST /api/gmail/sync while the status route is polled for live counts (per account when several sync) -> every
// cached read is refreshed and the result is announced, account by account when there are several.
// Gmail not connected, expired, demo or uploaded data: the control opens /connect or Google's consent instead.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppShellSync, AppShellSyncConfirm, AppShellSyncNotice } from "@/components/views/AppShellView";
import { getGmailPreview, toGmailFailure } from "@/lib/api/client";
import type { AccountResponse } from "@/lib/api/types";
import { connectHref } from "./accountLinks";
import { invalidate } from "./cache";
import { confirmFromPreview, deriveSyncButtonState, lastSyncLabel, shellProgress, syncFailureNotice, syncSuccessNotice } from "./syncButton";
import { runGmailSync, useRunningSyncAccountId, useSyncRunning } from "./syncRun";
import { useGmailSyncStatus } from "./syncStatus";
import { gmailProgress } from "@/app/sync/syncOutcome";

/** A success message disappears on its own; errors stay until dismissed. */
const SUCCESS_NOTICE_MS = 8000;
/** The relative "Last synced" text is recomputed this often. */
const LABEL_REFRESH_MS = 30_000;

export function useGmailSyncControl(account: AccountResponse | null, navigate: (href: string) => void): AppShellSync {
  const startedHere = useSyncRunning();
  const runningAccountId = useRunningSyncAccountId();
  const state = deriveSyncButtonState(account, startedHere);
  const running = state === "running";
  const status = useGmailSyncStatus(running);
  const [confirm, setConfirm] = useState<AppShellSyncConfirm | null>(null);
  // The account the open confirm is for; null = every connected account.
  const [confirmAccountId, setConfirmAccountId] = useState<string | null>(null);
  const [notice, setNotice] = useState<AppShellSyncNotice | null>(null);
  const [now, setNow] = useState(() => new Date());
  // Bumped on cancel and on start, so a preview that answers late is dropped.
  const previewToken = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), LABEL_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (notice?.tone !== "success") return;
    const timer = setTimeout(() => setNotice(null), SUCCESS_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // The confirm only makes sense while a sync can start (e.g. one began in another tab, or Gmail expired).
  useEffect(() => {
    if (state !== "ready" && confirm) {
      previewToken.current += 1;
      setConfirm(null);
    }
  }, [state, confirm]);

  // A sync started elsewhere (account says syncing, nothing from this tab): when the status stops being in flight,
  // refresh everything once so the account and ledger show the result.
  const startedElsewhere = running && !startedHere;
  const elsewhereFinished = startedElsewhere && status !== null && gmailProgress(status) === null;
  useEffect(() => {
    if (elsewhereFinished) void invalidate();
  }, [elsewhereFinished]);

  const onSyncAccount = useCallback(
    (accountId: string | null) => {
      // Demo or uploaded data: never replace it silently, explain the choice on /connect.
      if (state === "connect") {
        navigate("/connect");
        return;
      }
      if (state !== "ready") return;
      const token = (previewToken.current += 1);
      setNotice(null);
      setConfirmAccountId(accountId);
      setConfirm({ status: "loading" });
      getGmailPreview(accountId === null ? {} : { accountId })
        .then((preview) => {
          if (previewToken.current === token) setConfirm(confirmFromPreview(preview));
        })
        .catch((caught: unknown) => {
          if (previewToken.current !== token) return;
          setConfirm(null);
          setNotice(syncFailureNotice(toGmailFailure(caught), "preview"));
        });
    },
    [navigate, state],
  );

  const onSync = useCallback(() => onSyncAccount(null), [onSyncAccount]);

  const onCancelSync = useCallback(() => {
    previewToken.current += 1;
    setConfirm(null);
  }, []);

  const onStartSync = useCallback(() => {
    previewToken.current += 1;
    setConfirm(null);
    setNotice(null);
    runGmailSync(confirmAccountId === null ? {} : { accountId: confirmAccountId }).then(
      (response) => setNotice(syncSuccessNotice(response)),
      (caught: unknown) => setNotice(syncFailureNotice(toGmailFailure(caught), "sync")),
    );
  }, [confirmAccountId]);

  const onConnect = useCallback(() => {
    setNotice(null);
    // Not connected: the page that explains the choice. Expired grant: straight to Google's consent (a full navigation).
    if (state === "connect") navigate("/connect");
    else window.location.href = connectHref(account);
  }, [account, navigate, state]);

  const onDismissNotice = useCallback(() => setNotice(null), []);

  return {
    state,
    progress: running ? shellProgress(status) : null,
    lastSyncLabel: lastSyncLabel(account, state, now),
    confirm,
    notice,
    targetAccountId: confirm ? confirmAccountId : running ? runningAccountId : null,
    onSync,
    onSyncAccount,
    onConnect,
    onStartSync,
    onCancelSync,
    onDismissNotice,
  };
}
