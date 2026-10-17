// Shared shapes for the synthetic seed generator (issue #5). Everything here is fictional.

export type StoreCategory =
  | "marketplace"
  | "big_box"
  | "electronics"
  | "apparel"
  | "beauty"
  | "furniture"
  | "grocery"
  | "dtc_subscription";

/** "delivery" => window counts from the delivered date; "purchase" => from the order date. */
export type WindowAnchor = "delivery" | "purchase";

/** Policy sentences a store prints in its emails. Omitted = the store does not state it. */
export interface StorePolicy {
  returnWindowDays?: number;
  windowAnchor?: WindowAnchor;
  refundSlaDays?: number;
  priceAdjustDays?: number;
  /** Replaces the returns sentence with a final-sale sentence; suppresses return-deadline alerts. */
  finalSaleText?: string;
}

export type OrderEmailKind =
  | "order"
  | "order_resent"
  | "order_updated"
  | "shipped"
  | "delivered"
  | "return_started"
  | "return_dropped"
  | "return_received"
  | "refund"
  | "store_credit"
  | "cancel";

export interface StoreTemplate {
  key: string;
  name: string;
  domain: string;
  category: StoreCategory;
  senders: { orders: string; shipping: string; returns: string; refunds: string; marketing: string };
  supportPhone: string;
  hqAddress: string;
  carrier: string;
  policy: StorePolicy;
  /** Store-specific subject lines. */
  subject: (kind: OrderEmailKind, orderRef: string) => string;
  /** Optional store-specific opening sentence per email kind. */
  intro?: Partial<Record<OrderEmailKind, string>>;
  /** What the store calls store credit, e.g. "Bazaarly Gift Balance". */
  storeCreditName?: string;
}

export interface SeedLineItem {
  name: string;
  sku: string;
  qty: number;
  unitPrice: number;
  /** Third-party seller on a marketplace. */
  soldBy?: string;
}

/** Item subset for a shipment or return: sku + quantity. */
export interface SeedItemRef {
  sku: string;
  qty: number;
}

export interface OrderSnapshot {
  items: SeedLineItem[];
  tax: number;
  shipping: number;
  discount: number;
}

export interface RenderedEmail {
  from: string;
  subject: string;
  text: string;
  to?: string;
}

export interface SeedOrderEmail {
  id: string;
  kind: OrderEmailKind;
  /** ISO time the email was sent; also the event time stated in the body. */
  at: string;
  /** Shipment contents or returned items; omitted = whole order. */
  items?: SeedItemRef[];
  /** Refund / store-credit amount. */
  amount?: number;
  /** Order contents shown in this email when it differs from the final order (pre-update confirmation). */
  snapshot?: OrderSnapshot;
  /** Shipment number for split shipments ("1 of 2"). */
  shipment?: { index: number; count: number };
  /** Full (fake, Luhn-valid test) card number printed instead of "ending in" so redaction can be tested. */
  fullCardNumber?: string;
  /** Extra sentence shown in order confirmations and refund emails (e.g. currency notice, why a refund was issued). */
  note?: string;
  /** Edge-case tags for this email only. */
  tags?: string[];
  /** Custom renderer for one-off formats (non-English, forwarded). */
  render?: (order: SeedOrder, email: SeedOrderEmail) => RenderedEmail;
}

export interface SeedOrder {
  store: StoreTemplate;
  orderRef: string;
  placedAt: string;
  currency: string;
  /** Final order contents (after any "updated order" email). */
  items: SeedLineItem[];
  tax: number;
  shipping: number;
  discount: number;
  last4: string;
  cardBrand: string;
  /** Order-level override of the store policy (e.g. a final-sale clearance order). */
  policy?: StorePolicy;
  emails: SeedOrderEmail[];
  /** Edge-case tags applied to every email of this order. */
  tags: string[];
}

/** One-off email not tied to an order (marketing, phishing, account notices). */
export interface SeedStandaloneEmail {
  id: string;
  at: string;
  rendered: RenderedEmail;
  class: "marketing" | "not_receipt";
  merchant: string | null;
  merchantDomain: string | null;
  labels: string[];
  tags: string[];
}
