import type { PipelineStats } from "@/lib/pipeline/run";
import type { GmailFailure, GmailPreviewResponse, GmailSyncResponse, GmailSyncStatus } from "./gmailApi";

// Pure response -> screen mapping for /sync (#73). Every number shown comes from a real response (prefilter, Gmail
// preview/status/sync, upload); nothing is simulated.

/** Where a finished run goes: anything the ledger will show (orders or needs-review items) opens "/". */
export type RunOutcome = { kind: "open_ledger" } | { kind: "no_receipts"; detail: string };

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function runOutcome(stats: PipelineStats, detail: string): RunOutcome {
  if (stats.orders > 0 || stats.needsReview > 0) return { kind: "open_ledger" };
  return { kind: "no_receipts", detail };
}

/** POST /api/upload succeeded. Upload replaces the ledger, so an empty result is shown, not hidden. */
export function uploadOutcome(response: {
  stats: PipelineStats;
  files: Array<{ name: string }>;
  parseErrors: unknown[];
}): RunOutcome {
  const unparsed = response.parseErrors.length;
  const detail =
    `Read ${plural(response.stats.emails, "email")} from ${plural(response.files.length, "file")}` +
    `${unparsed > 0 ? ` (${unparsed} could not be parsed)` : ""}, but none looked like a purchase.`;
  return runOutcome(response.stats, detail);
}

/** POST /api/gmail/sync succeeded. `capped` is true only when more messages matched than the batch fetches. */
export function gmailSyncOutcome(response: GmailSyncResponse, maxMessages: number | null): RunOutcome {
  const cap = response.capped ? ` (stopped at the ${maxMessages ?? response.fetched}-message limit)` : "";
  const detail = `Fetched ${plural(response.fetched, "message")}${cap}, but none looked like a purchase.`;
  return runOutcome(response.stats, detail);
}

/** Preview copy for a connected Gmail account, from GET /api/gmail/preview. */
export function gmailPreviewText(preview: GmailPreviewResponse): string {
  const matching = preview.countIsEstimate
    ? `Gmail estimates about ${plural(preview.estimatedMessages, "matching message")}`
    : `Gmail found ${plural(preview.estimatedMessages, "matching message")}`;
  return (
    `${matching} from the last ${preview.windowDays} days. This sync fetches ` +
    `${plural(preview.messagesToFetch, "message")} (at most ${preview.maxMessages} per run). ` +
    `Read only: nothing is sent, moved, or deleted. Exact Gmail search: ${preview.query}`
  );
}

/**
 * Pending text while POST /api/gmail/sync runs, from GET /api/gmail/sync/status. Only an in-flight stage is shown:
 * idle/complete/failed can be left over from an earlier run (status is kept 15 minutes), so they say nothing about
 * this one. Processing has no count (the route reports none).
 */
export function gmailProgressText(status: GmailSyncStatus | null): string {
  const skipped = status && status.skipped > 0 ? `, ${status.skipped} skipped` : "";
  switch (status?.stage) {
    case "listing":
      return "Listing matching messages in Gmail…";
    case "fetching":
      return status.total === null
        ? `Fetched ${plural(status.fetched, "message")}${skipped}…`
        : `Fetched ${status.fetched} of ${plural(status.total, "message")}${skipped}…`;
    case "processing":
      return `Redacting, classifying and extracting ${plural(status.fetched, "fetched message")}${skipped}…`;
    default:
      return "Syncing…";
  }
}

export type SyncErrorKind =
  | "reconnect"
  | "already_running"
  | "timeout"
  | "rate_limited"
  | "access_denied"
  | "unreachable"
  | "failed";

export interface SyncErrorCopy {
  kind: SyncErrorKind;
  title: string;
  what: string;
  fix: string;
}

/** A failed Gmail call (preview or sync). The sync route publishes nothing on failure, so the prior ledger is kept. */
export function gmailErrorCopy(failure: GmailFailure, during: "preview" | "sync"): SyncErrorCopy {
  const kept = during === "sync" ? " Your previous ledger is unchanged." : "";
  if (failure.status === 401 || failure.code === "token_expired") {
    return {
      kind: "reconnect",
      title: "Your Gmail connection expired",
      what: "PaperTrail needs read-only permission again before it can sync.",
      fix: "Reconnect Gmail, then start the sync again.",
    };
  }
  if (failure.status === 409 || failure.code === "sync_already_running") {
    return {
      kind: "already_running",
      title: "A Gmail sync is already running",
      what: "Another sync for this account is still in progress, so this one did not start.",
      fix: "Wait for it to finish, then open what you're owed.",
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
