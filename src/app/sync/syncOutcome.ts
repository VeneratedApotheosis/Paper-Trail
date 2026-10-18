import type { SyncErrorInfo, SyncProgressInfo, SyncResultInfo } from "@/components/views/SyncView";
import type { PipelineStats } from "@/lib/pipeline/run";
import type { GmailFailure, GmailSyncResponse, GmailSyncStatus } from "@/lib/api/types";

// Pure response -> SyncView props mapping for /sync (#73, #104). Every number shown comes from a real response
// (prefilter, Gmail preview/status/sync, upload); nothing is simulated.

/** Where a finished run goes: anything the ledger will show (orders or needs-review items) opens "/". */
export interface RunOutcome {
  kind: "open_ledger" | "no_receipts";
  result: SyncResultInfo;
}

function runOutcome(stats: PipelineStats, result: SyncResultInfo): RunOutcome {
  return { kind: stats.orders > 0 || stats.needsReview > 0 ? "open_ledger" : "no_receipts", result };
}

function ledgerCounts(stats: PipelineStats): Pick<SyncResultInfo, "orders" | "needsReview" | "findings"> {
  return { orders: stats.orders, needsReview: stats.needsReview, findings: stats.findings };
}

/** POST /api/upload succeeded. Upload replaces the ledger, so an empty result is shown, not hidden. */
export function uploadOutcome(response: {
  stats: PipelineStats;
  files: Array<{ name: string }>;
  parseErrors: unknown[];
}): RunOutcome {
  return runOutcome(response.stats, {
    scanned: response.stats.emails,
    files: response.files.length,
    parseErrors: response.parseErrors.length,
    ...ledgerCounts(response.stats),
  });
}

/** POST /api/gmail/sync succeeded. `capped` is true only when more messages matched than the batch fetches. */
export function gmailSyncOutcome(response: GmailSyncResponse, maxMessages: number | null): RunOutcome {
  return runOutcome(response.stats, {
    scanned: response.fetched,
    parseErrors: response.parseErrors.length,
    capped: response.capped,
    ...(maxMessages !== null ? { maxMessages } : {}),
    ...ledgerCounts(response.stats),
  });
}

/**
 * Live progress while POST /api/gmail/sync runs, from GET /api/gmail/sync/status. Only an in-flight stage is shown:
 * idle/complete/failed can be left over from an earlier run (status is kept 15 minutes), so they say nothing about
 * this one and map to null (the view then shows a plain "syncing" state).
 */
export function gmailProgress(status: GmailSyncStatus | null): SyncProgressInfo | null {
  if (!status) return null;
  const { stage, fetched, total, skipped } = status;
  if (stage === "listing" || stage === "fetching" || stage === "processing") return { stage, fetched, total, skipped };
  // The promotions pass (#137) reports its own counts; the receipt counts stay in `fetched`/`total` of the status.
  if (stage === "promotions") return { stage, fetched: status.promotions?.fetched ?? 0, total: status.promotions?.total ?? null, skipped };
  return null;
}

/** A failed import, demo load, or prefilter preview while Gmail is not connected; `message` is the API's error text. */
export function importErrorCopy(during: "upload" | "demo" | "preview", message: string | null): SyncErrorInfo {
  const what = message ?? "The request did not complete.";
  if (during === "upload") {
    return {
      kind: "failed",
      title: "Couldn't import those files",
      what,
      fix: "Choose .eml or .mbox files, 5 MB in total at most.",
    };
  }
  return {
    kind: "failed",
    title: during === "demo" ? "Couldn't load the demo data" : "Couldn't load the sync preview",
    what,
    fix: "Check that the app server is running, then try again.",
  };
}

/** The Gmail session check (GET /api/auth/session) failed, so /sync can't tell which flow to show. */
export function sessionErrorCopy(message: string | null): SyncErrorInfo {
  return {
    kind: "failed",
    title: "Couldn't check your Gmail connection",
    what: message ?? "The session check did not complete.",
    fix: "Check that the app server is running, then try again.",
  };
}

/** The stored Gmail grant expired (session reports token_expired before any Gmail call). */
export const tokenExpiredCopy: SyncErrorInfo = {
  kind: "reconnect",
  title: "Your Gmail connection expired",
  what: "Google expires read-only access for unverified apps after 7 days. Your data is still here.",
  fix: "Reconnect Gmail so PaperTrail can read new receipts again.",
};

/** A failed Gmail call (preview or sync). The sync route publishes nothing on failure, so the prior ledger is kept. */
export function gmailErrorCopy(failure: GmailFailure, during: "preview" | "sync"): SyncErrorInfo {
  const kept = during === "sync" ? " Your previous ledger is unchanged." : "";
  if (failure.status === 401 || failure.code === "token_expired") {
    return {
      kind: "reconnect",
      title: "Your Gmail connection expired",
      what: "PaperTrail needs read-only permission again before it can sync.",
      fix: "Reconnect Gmail, then start the sync again.",
    };
  }
  if (failure.code === "sync_already_running") {
    return {
      kind: "already_running",
      title: "A Gmail sync is already running",
      what: "Another sync for this account is still in progress, so this one did not start.",
      fix: "Wait for it to finish, then open what you're owed.",
    };
  }
  if (failure.status === 409) {
    // Delete-all ran while the sync was working (#93): nothing was saved, and the previous ledger is gone too.
    return {
      kind: "failed",
      title: "Gmail sync did not complete",
      what: failure.error ?? "Your data was deleted while Gmail was syncing; nothing was saved.",
      fix: "Start the sync again if you want it.",
    };
  }
  if (failure.status === 504 || failure.code === "sync_timeout") {
    return {
      kind: "timeout",
      title: "Gmail sync took too long",
      what: `The sync stopped at its time limit before it finished.${kept}`,
      fix: "Try again in a moment.",
    };
  }
  if (failure.status === 429 || failure.code === "gmail_rate_limited") {
    return {
      kind: "rate_limited",
      title: "Gmail is limiting requests",
      what: `Gmail asked PaperTrail to slow down.${kept}`,
      fix: "Wait a minute, then try again.",
    };
  }
  if (failure.code === "gmail_access_denied") {
    return {
      kind: "access_denied",
      title: "Gmail denied access",
      what: `Gmail refused the read-only request.${kept}`,
      fix: "Reconnect Gmail and allow read-only access, then try again.",
    };
  }
  if (failure.status === 0) {
    return {
      kind: "unreachable",
      title: "Couldn't reach PaperTrail",
      what:
        during === "sync"
          ? "The connection dropped before the sync answered. It may still be running on the server."
          : "The Gmail preview could not be loaded.",
      fix: "Check that the app server is running, then try again.",
    };
  }
  const what =
    failure.code === "no_parseable_messages"
      ? "None of the fetched messages could be read."
      : failure.code === "extraction_unavailable"
        ? "Receipt extraction is unavailable right now."
        : (failure.error ?? `The request failed with status ${failure.status}.`);
  return {
    kind: "failed",
    title: during === "sync" ? "Gmail sync did not complete" : "Couldn't load the Gmail preview",
    what: `${what}${kept}`,
    fix: "Try again. If it keeps failing, check the server configuration.",
  };
}
