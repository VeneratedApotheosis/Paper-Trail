// UI-only view models. The canonical data shapes (NormalizedOrder, Finding,
// Extraction, RawEmail, ...) live in "@/lib/contracts" (#29) — import those,
// never redefine them here. This file only holds view models that have no
// backend contract yet (drafts, audit entries, owed summary). When a backend
// contract lands for any of these, delete it here and import instead.

export type AuditType =
  | "gmail_fetch"
  | "llm_call"
  | "approval"
  | "delete"
  | "sync_start"
  | "sync_complete";

export interface AuditEntry {
  id: string;
  at: string; // ISO
  type: AuditType;
  detail: string;
  redactedTokenCount?: number; // for llm_call
  model?: string; // for llm_call
  cost?: number; // USD, for llm_call
}

// Claim draft shown on the claim sheet (#17). Mirrors the `draft` DB table.
// Drafts are copy-to-clipboard / mailto only; the app never sends email.
export interface Draft {
  id: string;
  findingId: string;
  subject: string;
  body: string;
  recipient: string; // merchant support address (mailto target)
  signedName: string; // from receipt, falls back to Google profile name
  approvedAt?: string; // ISO; set only after explicit human approval
}

// Hero totals (#16). Low-confidence / needs-review items are excluded from the
// owed total until a human confirms them (AGENTS.md hard rule #7).
export interface OwedSummary {
  currency: string;
  owedTotal: number;
  findingCount: number;
  excludedCount: number;
  excludedTotal: number;
}
