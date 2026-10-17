import type { RawEmail } from "@/lib/contracts";
import { foldText, hasOrderRef, senderLocalPart } from "./text";

/**
 * Prefilter: only receipt-like mail is fetched or processed ("I don't want non-receipt mail touched", F1.3).
 * Gmail sync uses GMAIL_RECEIPT_QUERY; demo mode and .eml uploads skip Gmail search and use isReceiptLike().
 */

export const PREFILTER_WINDOW_DAYS = 90;

/** Subject words the Gmail query matches (English + basic Spanish). */
export const RECEIPT_SUBJECT_TERMS = [
  "order",
  "receipt",
  "shipped",
  "delivered",
  "return",
  "refund",
  "price adjustment",
  "invoice",
  "pedido",
  "reembolso",
  "devolución",
] as const;

/** Sender words the Gmail query matches (typical transactional mailbox names). */
export const RECEIPT_SENDER_TERMS = [
  "orders",
  "receipts",
  "shipping",
  "returns",
  "refunds",
  "billing",
  "auto-confirm",
] as const;

function gmailGroup(terms: readonly string[]): string {
  return terms.map((term) => (term.includes(" ") ? `"${term}"` : term)).join(" OR ");
}

/** Gmail `messages.list` q-parameter used for every sync. */
export const GMAIL_RECEIPT_QUERY = `newer_than:${PREFILTER_WINDOW_DAYS}d (subject:(${gmailGroup(
  RECEIPT_SUBJECT_TERMS,
)}) OR from:(${gmailGroup(RECEIPT_SENDER_TERMS)}))`;

/** Plain-language description of the query, shown to the user before a sync. */
export function describePrefilterQuery(): string {
  return [
    `PaperTrail only asks Gmail for messages from the last ${PREFILTER_WINDOW_DAYS} days`,
    `whose subject mentions ${RECEIPT_SUBJECT_TERMS.join(", ")},`,
    `or that come from senders named ${RECEIPT_SENDER_TERMS.join(", ")}.`,
    "Everything else in your inbox is never fetched.",
    `Exact Gmail search: ${GMAIL_RECEIPT_QUERY}`,
  ].join(" ");
}

export type PrefilterDecision = { keep: boolean; reason: string };

const SUBJECT_KEYWORDS =
  /\b(order|receipt|shipped|shipment|delivered|return|refund|price adjustment|invoice|cancel(?:l)?ed|pedido|recibo|reembolso|devolucion|enviado|entregado|factura|cancelado)\b/;

const SENDER_KEYWORDS =
  /^(orders?|receipts?|shipping|shipment|returns?|refunds?|billing|invoices?|auto-confirm|pedidos)$/;

/** Body phrases typical of transactional mail; two or more distinct hits keep the email. */
const BODY_KEYWORDS = [
  /\border (number|confirmation|summary|total)\b/,
  /\bsubtotal\b/,
  /\btotal\b/,
  /\btracking (number|#)/,
  /\brefund\b/,
  /\breturn (label|request|received)\b/,
  /\breceipt\b/,
  /\binvoice\b/,
  /\bshipped\b/,
  /\bdelivered\b/,
  /\bqty\b|\bquantity\b/,
  /\b(numero de pedido|reembolso|devolucion|enviado|entregado)\b/,
];

/** Unlabeled order-number shapes like "#NW-1001" or "#112-4455" in the subject. */
const SUBJECT_ORDER_NUMBER = /#\s?[a-z0-9]*\d[a-z0-9-]{2,}/;

/** Receipt-likeness heuristic for inputs that skip Gmail search (demo mode, .eml uploads). */
export function isReceiptLike(email: RawEmail): PrefilterDecision {
  const subject = foldText(email.subject);
  const subjectHit = SUBJECT_KEYWORDS.exec(subject);
  if (subjectHit) return { keep: true, reason: `subject mentions "${subjectHit[1]}"` };

  const localPart = senderLocalPart(email.from);
  if (localPart && SENDER_KEYWORDS.test(localPart)) {
    return { keep: true, reason: `transactional sender "${localPart}@"` };
  }

  const body = foldText(email.text);
  if (SUBJECT_ORDER_NUMBER.test(subject) || hasOrderRef(subject) || hasOrderRef(body)) {
    return { keep: true, reason: "contains an order number" };
  }

  const bodyHits = BODY_KEYWORDS.filter((pattern) => pattern.test(body)).length;
  if (bodyHits >= 2) return { keep: true, reason: `body has ${bodyHits} receipt keywords` };

  return { keep: false, reason: "no receipt keywords, transactional sender, or order number" };
}
