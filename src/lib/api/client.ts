import type { AuditEntry } from "@/lib/types";
import type {
  AccountResponse,
  ApiErrorBody,
  AuditResponse,
  ClaimApproveResponse,
  ClaimEditRequest,
  ClaimRegenerateRequest,
  ClaimRegenerateResponse,
  ClaimResponse,
  DeleteAllResponse,
  DisconnectResponse,
  FindingResponse,
  FindingStatusRequest,
  FindingStatusResponse,
  FindingStatusUpdate,
  GmailFailure,
  GmailPreviewResponse,
  GmailSyncResponse,
  GmailSyncStatus,
  LedgerResponse,
  MerchantExcludeResponse,
  OrderResponse,
  PipelineRunResponse,
  PrefilterResponse,
  ResetDemoResponse,
  SessionStatus,
  UploadResponse,
} from "./types";
import { encodeIdSegment } from "./ids";

export { safeDecode } from "./ids";

/**
 * Typed browser client for the PaperTrail JSON API (docs/api.md). The UI imports this instead of
 * `@/lib/mock/data`; every function returns the contract shapes and throws ApiError on a non-2xx response.
 * Id arguments may be raw or already percent-encoded (e.g. a Next `params.id`): they are decoded once with
 * `safeDecode`, then encoded, so `/api/orders/order%3A...` is never double-encoded into a 404.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = json !== null && typeof json === "object" && "error" in json ? (json as ApiErrorBody) : null;
    throw new ApiError(response.status, body);
  }
  return json as T;
}

function sendJson(method: "POST" | "PUT" | "DELETE", body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** Gmail connection status; never throws on 401/503 (those bodies still carry `connected: false`). */
export async function getSessionStatus(): Promise<SessionStatus> {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  const json = (await response.json().catch(() => null)) as SessionStatus | null;
  return json ?? { connected: false };
}

/**
 * Gmail connection, mailbox, last sync time, row counts and `syncing` for the current account; also works for
 * anonymous users (`gmail.connected: false`). After `disconnectGmail`, a sync, or `deleteAll`, refetch it and the ledger.
 */
export function getAccount(): Promise<AccountResponse> {
  return request("/api/account");
}

/** Revokes the Google grant and clears stored tokens + mailbox; the synced ledger and the sign-in are kept. */
export function disconnectGmail(): Promise<DisconnectResponse> {
  return request("/api/auth/disconnect", { method: "POST" });
}

/** What the UI branches on after a failed Gmail call: HTTP status, the route's `code`, and its message (status 0 = offline). */
export function toGmailFailure(error: unknown): GmailFailure {
  if (error instanceof ApiError) {
    return { status: error.status, code: error.body?.code ?? null, error: error.body?.error ?? null };
  }
  return { status: 0, code: null, error: null };
}

/**
 * GET /api/gmail/preview: the exact search and how many messages a sync would read (50 at most). Needs a live Gmail
 * grant: 401 `token_expired` otherwise. Never reads message bodies.
 */
export function getGmailPreview(): Promise<GmailPreviewResponse> {
  return request("/api/gmail/preview");
}

/**
 * POST /api/gmail/sync `{ confirmed: true }`: runs the whole sync in one request (240 s budget; 504 `sync_timeout`
 * after that) and replaces the ledger on success. Call it only after the user confirmed the preview. Other failures:
 * 401 `token_expired`, 409 `sync_already_running`, 429 `gmail_rate_limited`, 403 `gmail_access_denied`.
 * A sync changes the ledger, audit log and account: `invalidate()` afterwards (even on failure).
 */
export function syncGmail(): Promise<GmailSyncResponse> {
  return request("/api/gmail/sync", sendJson("POST", { confirmed: true }));
}

/** GET /api/gmail/sync/status: live progress of the sync running for this account (poll while one runs). */
export function getGmailSyncStatus(): Promise<GmailSyncStatus> {
  return request("/api/gmail/sync/status");
}

export function getLedger(): Promise<LedgerResponse> {
  return request("/api/ledger");
}

export function getOrder(id: string): Promise<OrderResponse> {
  return request(`/api/orders/${encodeIdSegment(id)}`);
}

export function getFinding(id: string): Promise<FindingResponse> {
  return request(`/api/findings/${encodeIdSegment(id)}`);
}

/**
 * Marks a finding `resolved` (money came back), `dismissed`, or `open` again; returns the finding and the new owed
 * summary. Open and drafted ("claim sent") findings count toward owed; `drafted` is set by `approveClaim`.
 */
export function setFindingStatus(id: string, status: FindingStatusUpdate): Promise<FindingStatusResponse> {
  return request(`/api/findings/${encodeIdSegment(id)}/status`, sendJson("POST", { status } satisfies FindingStatusRequest));
}

export function loadDemo(): Promise<PipelineRunResponse> {
  return request("/api/demo", { method: "POST" });
}

export function resetDemo(): Promise<ResetDemoResponse> {
  return request("/api/demo", { method: "DELETE" });
}

/** Uploads .eml / .mbox files (5 MB total) and replaces the ledger with the parsed result. */
export function uploadFiles(files: Iterable<File>): Promise<UploadResponse> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  return request("/api/upload", { method: "POST", body: form });
}

export function getPrefilter(): Promise<PrefilterResponse> {
  return request("/api/prefilter");
}

/** Audit log, newest first. */
export async function getAudit(): Promise<AuditEntry[]> {
  const body = await request<AuditResponse>("/api/audit");
  return body.entries;
}

export function deleteAll(): Promise<DeleteAllResponse> {
  return request("/api/delete-all", { method: "POST" });
}

export function excludeMerchant(merchant: string): Promise<MerchantExcludeResponse> {
  return request("/api/merchants/exclude", sendJson("POST", { merchant }));
}

export function includeMerchant(merchant: string): Promise<MerchantExcludeResponse> {
  return request("/api/merchants/exclude", sendJson("DELETE", { merchant }));
}

function claimPath(findingId: string): string {
  return `/api/claims/${encodeIdSegment(findingId)}`;
}

/** Stored claim draft for a finding, generated from the template on first open. */
export function getClaim(findingId: string): Promise<ClaimResponse> {
  return request(claimPath(findingId));
}

/** Regenerates the draft (discards edits); `rephrase` uses the LLM only when the server has a key. */
export function regenerateClaim(findingId: string, options: ClaimRegenerateRequest = {}): Promise<ClaimRegenerateResponse> {
  return request(claimPath(findingId), sendJson("POST", options));
}

export function saveClaim(findingId: string, edits: ClaimEditRequest): Promise<ClaimResponse> {
  return request(claimPath(findingId), sendJson("PUT", edits));
}

/** Records approval and returns `mailtoUrl` + `clipboardText`. The app never sends the email. */
export function approveClaim(findingId: string): Promise<ClaimApproveResponse> {
  return request(`${claimPath(findingId)}/approve`, { method: "POST" });
}
