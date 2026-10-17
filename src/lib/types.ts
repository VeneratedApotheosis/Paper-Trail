// Shared UI view-model types (the UI<->backend contract).
// These are serializable projections of the Drizzle schema (src/db/schema/**)
// with dates as ISO strings. UI builds against these so screens and the backend
// can proceed in parallel (COORDINATION.md §10). Import these — never redefine.

export type OrderStatus =
  | "ordered"
  | "shipped"
  | "delivered"
  | "return_started"
  | "returned"
  | "refunded"
  | "cancelled";

export type EventType =
  | "ordered"
  | "shipped"
  | "delivered"
  | "return_started"
  | "return_dropped"
  | "return_received"
  | "refund_issued"
  | "store_credit"
  | "price_adjust"
  | "cancel";

export type FindingKind =
  | "refund_overdue"
  | "refund_short"
  | "return_deadline"
  | "price_drop"
  | "rewards_gap";

export type FindingStatus = "open" | "drafted" | "resolved" | "dismissed";

export type PriceSource = "mock" | "json_ld" | "api" | "email_promo" | "user";

export interface SourceEmail {
  subject: string;
  fromDomain: string;
  receivedAt: string; // ISO
}

export interface OrderEvent {
  id: string;
  type: EventType;
  at: string; // ISO
  amount?: number;
  conf?: number;
  evidenceQuote?: string; // <=200 chars; snippet only, never a raw body
  source?: SourceEmail;
}

export interface LineItem {
  id: string;
  name: string;
  sku?: string;
  qty: number;
  unitPrice: number;
  returnedQty: number;
}

export interface Order {
  id: string;
  merchantName: string;
  merchantDomain: string;
  orderRef?: string;
  placedAt: string; // ISO
  currency: string; // ISO 4217, e.g. "USD"
  subtotal?: number;
  tax?: number;
  shipping?: number;
  discount?: number;
  total: number;
  last4?: string;
  status: OrderStatus;
  confMin: number; // lowest field confidence on the order; <0.7 => needs review
  lineItems: LineItem[];
  events: OrderEvent[];
  source: SourceEmail;
}

// Why-this-is-owed payload. Numbers come from deterministic rules, never the LLM.
export interface FindingExplain {
  rule: string; // e.g. "refund_overdue"
  summary: string; // one-line plain-language reason
  dates: { label: string; value: string }[];
  sourceQuote: string; // policy / evidence quote shown to the user
  confidence: number; // 0..1
  priceSource?: PriceSource; // labelled when a price feed is involved
}

export interface Finding {
  id: string;
  orderId: string;
  merchantName: string;
  kind: FindingKind;
  amountAtStake: number;
  currency: string;
  dueAt?: string; // ISO; deadline for return_deadline / price_drop windows
  severity: "high" | "medium" | "low";
  status: FindingStatus;
  ruleVersion: string;
  explain: FindingExplain;
}

export interface Draft {
  id: string;
  findingId: string;
  subject: string;
  body: string;
  recipient: string; // merchant support address (mailto target)
  signedName: string; // from receipt, falls back to Google profile name
  approvedAt?: string; // ISO; set only after explicit human approval
}

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

// Totals shown on the hero. Low-confidence items are excluded until confirmed.
export interface OwedSummary {
  currency: string;
  owedTotal: number; // sum of confirmed, conf>=0.7 open findings
  findingCount: number;
  excludedCount: number; // needs-review items held out of the total
  excludedTotal: number;
}
