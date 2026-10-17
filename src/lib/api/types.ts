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

export interface LedgerResponse {
  mode: StoreMode;
  asOf: string | null;
  orders: NormalizedOrder[];
  findings: Finding[];
  summary: OwedSummary;
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

export interface PipelineRunResponse {
  mode: StoreMode;
  asOf: string;
  summary: OwedSummary;
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
