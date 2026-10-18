import type { ClaimDraft } from "@/lib/claims";
import type { Finding, NormalizedOrder } from "@/lib/contracts";
import type { PipelineStats, ReviewQueueItem } from "@/lib/pipeline/run";
import type { RedactionMode } from "@/lib/ingestion/prepare";
import type { GmailAccountPreview, GmailAccountSync, SyncAccountsResult } from "@/lib/gmail/accounts";
import type { GmailSyncProgress } from "@/lib/gmail/progress";
import type { previewGmail } from "@/lib/gmail/service";
import type { RealEvalReport } from "@/lib/eval/real";
import type { ExperimentRequest, ExperimentResult } from "@/lib/quality/experiment";
import type { PromotionsResponse } from "@/lib/promotions/state";
import type { NotReceiptFeedbackResult, PromotionFeedbackResult, ReceiptFeedbackResult } from "@/lib/quality/feedback";
import type { QualityResponse } from "@/lib/quality/state";
import type { SkippedEmail, SyncQualityReport } from "@/lib/quality/types";
import type { DeleteAllResult, StoreMode } from "@/lib/store";
import type { AuditEntry, OwedSummary } from "@/lib/types";

/** JSON shapes of the PaperTrail API routes (docs/api.md). Shared by route handlers and the typed client. */

export type { PipelineStats, ReviewQueueItem, StoreMode };

export const API_LABELS = {
  demo: "Demo data — synthetic",
  simulatedPrice: "Simulated price feed",
  precomputedExtraction: "Extracted from precomputed seed labels (no LLM call)",
} as const;

export interface ApiErrorBody {
  error: string;
  details?: unknown;
  /** Machine-readable reason on Gmail routes: token_expired, sync_already_running, sync_timeout, gmail_rate_limited, ... */
  code?: string;
}

/** Owed summary as served by the API (`computeOwed` in src/lib/rules/owed.ts): the claim-sent fields are always set. */
export type LedgerSummary = Required<Omit<OwedSummary, "owedByCurrency">> & Pick<OwedSummary, "owedByCurrency">;

export interface LedgerResponse {
  mode: StoreMode;
  asOf: string | null;
  orders: NormalizedOrder[];
  findings: Finding[];
  summary: LedgerSummary;
  reviewQueue: ReviewQueueItem[];
  excludedMerchants: string[];
  stats: PipelineStats | null;
  labels: {
    demo: typeof API_LABELS.demo;
    simulatedPrice: typeof API_LABELS.simulatedPrice;
    /** Set when any extraction came from seed gold labels instead of an LLM. */
    precomputedExtraction: typeof API_LABELS.precomputedExtraction | null;
  };
}

export interface OrderResponse {
  order: NormalizedOrder;
  findings: Finding[];
}

export interface FindingResponse {
  finding: Finding;
  order: NormalizedOrder;
}

/** Statuses the user may set by hand. `drafted` is set only by approving a claim (POST /api/claims/:findingId/approve). */
export const FINDING_STATUS_UPDATES = ["resolved", "dismissed", "open"] as const;
export type FindingStatusUpdate = (typeof FINDING_STATUS_UPDATES)[number];

export interface FindingStatusRequest {
  status: FindingStatusUpdate;
}

/** POST /api/findings/:id/status: the updated finding plus the recomputed owed summary. */
export interface FindingStatusResponse {
  finding: Finding;
  summary: LedgerSummary;
}

export interface PipelineRunResponse {
  mode: StoreMode;
  asOf: string;
  summary: LedgerSummary;
  stats: PipelineStats;
}

export interface UploadResponse extends PipelineRunResponse {
  files: Array<{ name: string; emails: number }>;
  /** Messages that could not be parsed (they are not processed). */
  parseErrors: Array<{ file: string; index: number; reason: string }>;
}

export interface ResetDemoResponse {
  mode: StoreMode;
}

export interface PrefilterResponse {
  query: string;
  description: string;
  windowDays: number;
  /** PAPERTRAIL_REDACT (#125): "off" = receipt text reaches the AI unredacted. Copy about redaction must follow it. */
  redaction: RedactionMode;
}

export interface AuditResponse {
  /** Newest first. */
  entries: AuditEntry[];
}

export type DeleteAllResponse = DeleteAllResult;

export interface MerchantExcludeResponse {
  excludedMerchants: string[];
}

/** Claim draft as stored and served by /api/claims/:findingId (issue #35). */
export interface ClaimDraftRecord extends ClaimDraft {
  /** True once the user saved their own subject/body/recipient (PUT); regenerating resets it. */
  edited: boolean;
  /** True when the body is a fact-checked LLM rewording of the template (POST with `rephrase: true`). */
  rephrased: boolean;
}

export interface ClaimResponse {
  draft: ClaimDraftRecord;
  finding: Finding;
  order: NormalizedOrder;
}

export interface ClaimRegenerateRequest {
  profileName?: string;
  supportEmail?: string;
  /** Ask the LLM to reword the template; only honored when the server has ANTHROPIC_API_KEY. */
  rephrase?: boolean;
}

export interface ClaimRegenerateResponse extends ClaimResponse {
  rephrased: boolean;
  /** Why the template wording was kept; set when `rephrased` is false. */
  reason?: string;
}

export interface ClaimEditRequest {
  subject: string;
  body: string;
  recipient: string;
}

/** The app never sends: the user copies `clipboardText` or opens `mailtoUrl` in their own mail client. */
export interface ClaimApproveResponse {
  draft: ClaimDraftRecord;
  mailtoUrl: string;
  clipboardText: string;
}

/**
 * GET /api/auth/session (Chelsea's route): Gmail connection status. Served with 401 when not connected and 503 when
 * auth is unavailable; `connected: false` is normal in demo mode and is not an error.
 */
export interface SessionStatus {
  connected: boolean;
  error?: string;
  reconnectUrl?: string;
}

/** One linked Gmail account in GET /api/account (#114). */
export interface LinkedAccount {
  id: string;
  mailbox: string | null;
  connected: boolean;
  expired: boolean;
  lastSyncAt: string | null;
}

/** GET /api/account (issue #109): connection and sync status of the current account. Never carries tokens. */
export interface AccountResponse {
  gmail: {
    /** A locally valid Gmail grant exists. False for anonymous users and after expiry or Disconnect Gmail. */
    connected: boolean;
    /** Signed in but the Gmail grant is gone (expired, revoked, disconnected): offer Connect Gmail again. */
    expired: boolean;
    /** Connected Gmail address (stored encrypted with the tokens); null when anonymous, unknown or cleared. */
    mailbox: string | null;
  };
  /**
   * Every Gmail account linked to this profile (#114), the profile's first mailbox first. `id` is what
   * `NormalizedOrder.sources` carries; a disconnected account stays listed (`connected: false`, `mailbox: null`) while its
   * purchases remain in the ledger. `lastSyncAt` is that account's last published sync. Empty for anonymous users.
   */
  accounts: LinkedAccount[];
  mode: StoreMode;
  asOf: string | null;
  /** When the last Gmail sync was published; null before the first sync and after delete-all. */
  lastSyncAt: string | null;
  /** Visible rows (excluded merchants already removed). */
  counts: { orders: number; findings: number; reviewItems: number };
  excludedMerchants: string[];
  /** A Gmail sync is running for this account right now. */
  syncing: boolean;
  /** PAPERTRAIL_REDACT (#125): "on" = PII is redacted before any AI call; "off" (default) = receipt text is sent as is. */
  redaction: RedactionMode;
}

/** POST /api/auth/disconnect `{ accountId? }`: Gmail grant(s) cleared; the signed-in identity and the synced ledger are kept. */
export interface DisconnectResponse {
  disconnected: true;
  /** Google confirmed the revocation. False when no grant existed or Google was unreachable (credentials are cleared anyway). */
  revokedToken: boolean;
}

/**
 * GET /api/gmail/preview[?accountId=]: { query, estimatedMessages, messagesToFetch, countIsEstimate, windowDays,
 * maxMessages, redaction (#125) } summed over the accounts that answered, plus `accounts` with each account's result (#114). Accounts that
 * could not be read are `{ ok: false, code }` (e.g. `token_expired`); the call fails only when none could.
 */
export type GmailPreviewResponse = Awaited<ReturnType<typeof previewGmail>> & { accounts: GmailAccountPreview[]; redaction: RedactionMode };

/**
 * POST /api/gmail/sync `{ confirmed: true, accountId? }`: the PipelineRunResponse (merged ledger of every account)
 * plus { fetched, capped, parseErrors } summed over the accounts synced and `accounts` with each account's outcome.
 */
export type GmailSyncResponse = PipelineRunResponse & SyncAccountsResult;
export type { GmailAccountPreview, GmailAccountSync };

/** GET /api/gmail/sync/status: transient in-process progress of the running sync (stage idle when none ran recently). */
export type GmailSyncStatus = GmailSyncProgress;

/** A failed Gmail call reduced to what the UI branches on. `status` 0 means no HTTP response (network failure). */
export interface GmailFailure {
  status: number;
  code: string | null;
  error: string | null;
}

/** GET /api/quality: the latest sync quality report and up to 20 runs (oldest first) of this account (#117). */
export type QualityReportsResponse = QualityResponse;
export type { ExperimentRequest, ExperimentResult, SkippedEmail, SyncQualityReport };

/** GET /api/quality/skipped: emails that produced no order; safe metadata only. */
export interface SkippedEmailsResponse {
  skipped: SkippedEmail[];
  total: number;
}

/** POST /api/quality/skipped/:emailId/receipt: the outcome plus the recomputed owed summary. */
export type MarkReceiptResponse = ReceiptFeedbackResult & { summary: LedgerSummary };
export type MarkNotReceiptResponse = NotReceiptFeedbackResult & { summary: LedgerSummary };

/** POST /api/quality/skipped/:emailId/promotion: the promotion now listed for the email. */
export type MarkPromotionResponse = PromotionFeedbackResult;

/** GET /api/promotions: offers read from marketing emails (#131); never part of the owed total. */
export type { PromotionsResponse };

/** GET /api/quality/eval: scores against the saved labels (cache only, never calls a model). */
export type QualityEvalResponse = RealEvalReport & { model: string };

