import type { PipelineRunResponse } from "@/lib/api/types";
import type { GmailSyncProgress } from "@/lib/gmail/progress";
import type { GmailSyncResult, previewGmail } from "@/lib/gmail/service";

// Same-origin calls to the Gmail routes (docs/gmail-sync.md) for the /sync wrapper (#73). Local to this route folder
// because src/lib/api/client.ts has no Gmail functions yet; they belong there as getGmailPreview() / syncGmail() /
// getGmailSyncStatus(). Unlike client.ts these return the failure instead of throwing, so the page can branch on the
// HTTP status and the route's `code` (token_expired, sync_already_running, sync_timeout, ...).

/** GET /api/gmail/preview: { query, estimatedMessages, messagesToFetch, countIsEstimate, windowDays, maxMessages }. */
export type GmailPreviewResponse = Awaited<ReturnType<typeof previewGmail>>;

/** POST /api/gmail/sync: the PipelineRunResponse plus { fetched, capped, parseErrors }. */
export type GmailSyncResponse = PipelineRunResponse & Omit<GmailSyncResult, "result">;

/** GET /api/gmail/sync/status: transient in-process progress of the running sync. */
export type GmailSyncStatus = GmailSyncProgress;

/** `status` 0 means the request never got an HTTP response (network failure). */
export interface GmailFailure {
  status: number;
  code: string | null;
  error: string | null;
}

export type GmailCall<T> = { ok: true; data: T } | { ok: false; failure: GmailFailure };

function readString(body: unknown, key: string): string | null {
  if (body === null || typeof body !== "object" || !(key in body)) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

async function callGmail<T>(path: string, init?: RequestInit): Promise<GmailCall<T>> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...init });
  } catch {
    return { ok: false, failure: { status: 0, code: null, error: null } };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || body === null) {
    return {
      ok: false,
      failure: { status: response.status, code: readString(body, "code"), error: readString(body, "error") },
    };
  }
  return { ok: true, data: body as T };
}

export function getGmailPreview(): Promise<GmailCall<GmailPreviewResponse>> {
  return callGmail("/api/gmail/preview");
}

/** Runs the whole sync in one request (up to the route's 240 s budget). The user confirmed the preview first. */
export function syncGmail(): Promise<GmailCall<GmailSyncResponse>> {
  return callGmail("/api/gmail/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmed: true }),
  });
}

export function getGmailSyncStatus(): Promise<GmailCall<GmailSyncStatus>> {
  return callGmail("/api/gmail/sync/status");
}
