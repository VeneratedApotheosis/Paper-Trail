import type { ClaimDraft } from "@/lib/claims";
import type { Finding, NormalizedOrder } from "@/lib/contracts";
import type { PipelineStats, ReviewQueueItem } from "@/lib/pipeline/run";
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
}

/** Owed summary as served by the API (`computeOwed` in src/lib/rules/owed.ts): the claim-sent fields are always set. */
export type LedgerSummary = Required<OwedSummary>;

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
  mode: StoreMode;
  asOf: string | null;
  /** When the last Gmail sync was published; null before the first sync and after delete-all. */
  lastSyncAt: string | null;
  /** Visible rows (excluded merchants already removed). */
  counts: { orders: number; findings: number; reviewItems: number };
  excludedMerchants: string[];
  /** A Gmail sync is running for this account right now. */
  syncing: boolean;
}

/** POST /api/auth/disconnect: Gmail grant cleared; the signed-in identity and the synced ledger are kept. */
export interface DisconnectResponse {
  disconnected: true;
  /** Google confirmed the revocation. False when no grant existed or Google was unreachable (credentials are cleared anyway). */
  revokedToken: boolean;
}
