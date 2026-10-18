import type { EmailClass, Extraction, RawEmail } from "@/lib/contracts";

/**
 * Dedup test set (#126): synthetic emails about the same or different purchases, each labelled with the purchase it
 * belongs to (`purchase`). Fictional stores on reserved .example domains, invented names, no real data.
 * `scenario` groups the cases the issue lists; MUST-NOT-MERGE cases are marked `mustNotMerge`.
 */

export interface DedupSpec {
  id: string;
  scenario: string;
  /** Ground truth: emails with the same `purchase` are one purchase. */
  purchase: string;
  cls?: EmailClass;
  /** Sender header; default `"<merchant>" <orders@<domain>>`. */
  from?: string;
  subject?: string;
  date: string;
  merchant: string | null;
  /** Extracted merchantDomain; also the default sender domain. */
  domain?: string | null;
  ref?: string | null;
  otherRefs?: string[];
  currency?: string;
  total?: number | null;
  eventAmount?: number | null;
  items?: Array<[name: string, qty: number, unitPrice: number]>;
  messageId?: string;
  threadId?: string;
  account?: string;
  /** Body text; default is derived from the other fields (so look-alike emails get identical text). */
  text?: string;
}

const NORTHWIND = { merchant: "Northwind Outfitters", domain: "northwind.example" };
const BREWBOX = { merchant: "Brewbox Coffee", domain: "brewbox.example" };

/** The labelled set. Dates are 2026-09/10; amounts are invented. */
export const DEDUP_SPECS: DedupSpec[] = [
  // Amazon name variants across senders, domains and countries: one purchase.
  { id: "amz-order", scenario: "amazon name variants", purchase: "amz-1", merchant: "Amazon.com", domain: null, from: '"Amazon.com" <auto-confirm@amazon.com>', ref: "112-1234567-1234567", date: "2026-09-01T10:00:00Z", total: 59.99, items: [["Desk Lamp", 1, 39.99], ["USB Cable", 2, 10]] },
  { id: "amz-ship", scenario: "amazon name variants", purchase: "amz-1", cls: "shipped", merchant: "AMAZON MARKETPLACE", domain: null, from: '"Amazon" <shipment-tracking@amazon.co.uk>', ref: "112 1234567 1234567", date: "2026-09-03T09:00:00Z", items: [["Desk Lamp", 1, 39.99]] },
  { id: "amz-delivered", scenario: "amazon name variants", purchase: "amz-1", cls: "delivered", merchant: "Amazon", domain: null, from: '"Amazon" <order-update@amazon.com>', ref: "#1121234567-1234567", date: "2026-09-05T15:00:00Z" },

  // Order number vs invoice number vs confirmation number: emails share ANY reference.
  { id: "baz-confirm", scenario: "order vs invoice vs confirmation numbers", purchase: "baz-1", merchant: "Bazaarly", domain: "bazaarly.example", ref: "ORD-1001", otherRefs: ["WEB-77-AB"], date: "2026-09-02T10:00:00Z", total: 84.5, items: [["Ceramic Planter", 1, 84.5]] },
  { id: "baz-invoice", scenario: "order vs invoice vs confirmation numbers", purchase: "baz-1", merchant: "Bazaarly Inc.", domain: "bazaarly.example", from: '"Bazaarly Billing" <billing@mail.bazaarly.example>', subject: "Invoice WEB-77-AB", ref: "WEB-77-AB", otherRefs: ["ORD-1001"], date: "2026-09-03T08:00:00Z", total: 84.5, items: [["Ceramic Planter", 1, 84.5]] },
  { id: "baz-shipped", scenario: "order vs invoice vs confirmation numbers", purchase: "baz-1", cls: "shipped", merchant: "Bazaarly", domain: "bazaarly.example", ref: "WEB 77 AB", date: "2026-09-04T12:00:00Z" },

  // Forwarded copy (from the shopper's own mailbox, with another spelling of the store).
  { id: "lum-order", scenario: "forwarded copy", purchase: "lum-1", merchant: "Lumen Beauty", domain: "lumen-beauty.example", ref: "LB-5521", date: "2026-10-02T09:00:00Z", total: 46, items: [["Glow Serum", 1, 46]] },
  { id: "lum-forward", scenario: "forwarded copy", purchase: "lum-1", merchant: "Lumen Beauty Co.", domain: null, from: '"Sam Rivera" <sam.rivera@gmail.com>', subject: "Fwd: Your Lumen Beauty order LB-5521", ref: "LB5521", date: "2026-10-03T18:30:00Z", total: 46, items: [["Glow Serum", 1, 46]] },

  // Resent receipt: same order number, new Message-ID, next day.
  { id: "gm-order", scenario: "resent receipt", purchase: "gm-1", merchant: "GrandMart", domain: "grandmart.example", ref: "GM-7001", messageId: "gm-7001-a@grandmart.example", date: "2026-09-12T11:00:00Z", total: 132.4, items: [["Stand Mixer", 1, 132.4]] },
  { id: "gm-resent", scenario: "resent receipt", purchase: "gm-1", merchant: "GrandMart", domain: "grandmart.example", ref: "GM-7001", messageId: "gm-7001-b@grandmart.example", date: "2026-09-13T11:00:00Z", total: 132.4, items: [["Stand Mixer", 1, 132.4]] },

  // The same message twice in ONE inbox (same Message-ID, two Gmail ids): collapsed before extraction.
  { id: "sc-1", scenario: "exact copy in one inbox", purchase: "sc-1", merchant: "Lumen Beauty", domain: "lumen-beauty.example", ref: null, messageId: "<sc-1@lumen-beauty.example>", date: "2026-09-28T10:00:00Z", total: 22, items: [["Lip Balm", 2, 11]] },
  { id: "sc-2", scenario: "exact copy in one inbox", purchase: "sc-1", merchant: "Lumen Beauty", domain: "lumen-beauty.example", ref: null, messageId: "sc-1@lumen-beauty.example", date: "2026-09-28T10:00:00Z", total: 22, items: [["Lip Balm", 2, 11]] },

  // The same email delivered to two linked inboxes, no order number: same Message-ID.
  { id: "bb-acct-a", scenario: "same email in two accounts, no ref", purchase: "bb-1", ...BREWBOX, ref: null, account: "acct-a", messageId: "bb-receipt-9@brewbox.example", date: "2026-09-20T07:45:00Z", total: 18.5, items: [["Espresso Beans 1kg", 1, 18.5]] },
  { id: "bb-acct-b", scenario: "same email in two accounts, no ref", purchase: "bb-1", ...BREWBOX, ref: null, account: "acct-b", messageId: "bb-receipt-9@brewbox.example", date: "2026-09-20T07:45:00Z", total: 18.5, items: [["Espresso Beans 1kg", 1, 18.5]] },

  // Late delivery (7 days) with no order number: attach by items.
  { id: "fc-order", scenario: "late delivery without ref", purchase: "fc-1", merchant: "FreshCart Home", domain: "freshcart.example", ref: "FC-9001", date: "2026-09-01T10:00:00Z", total: 120, items: [["Oak Chair", 1, 120]] },
  { id: "fc-shipped", scenario: "late delivery without ref", purchase: "fc-1", cls: "shipped", merchant: "FreshCart Home", domain: "freshcart.example", ref: null, date: "2026-09-03T10:00:00Z", items: [["Oak Chair", 1, 120]] },
  { id: "fc-delivered", scenario: "late delivery without ref", purchase: "fc-1", cls: "delivered", merchant: "FreshCart Home", domain: "freshcart.example", ref: null, date: "2026-09-08T10:00:00Z", items: [["Oak Chair", 1, 120]] },

  // Refund three weeks later with no order number: attach by items + amount.
  { id: "nw-order-4001", scenario: "refund without ref", purchase: "nw-4001", ...NORTHWIND, ref: "NW-4001", date: "2026-09-01T10:00:00Z", total: 80, items: [["Rain Jacket", 1, 80]] },
  { id: "nw-refund-4001", scenario: "refund without ref", purchase: "nw-4001", cls: "refund", ...NORTHWIND, ref: null, date: "2026-09-22T10:00:00Z", eventAmount: 80, items: [["Rain Jacket", 1, 80]] },

  // Order update and split shipment: same order number.
  { id: "ok-order", scenario: "order update and split shipment", purchase: "ok-1", merchant: "Oakhaven Home", domain: "oakhaven.example", ref: "OK-100", date: "2026-10-01T10:00:00Z", total: 70, items: [["Linen Throw", 1, 40], ["Candle Set", 1, 30]] },
  { id: "ok-update", scenario: "order update and split shipment", purchase: "ok-1", merchant: "Oakhaven Home", domain: "oakhaven.example", subject: "Your order was updated", ref: "OK-100", date: "2026-10-02T10:00:00Z", total: 75, items: [["Linen Throw", 1, 40], ["Candle Set", 1, 30], ["Gift Wrap", 1, 5]] },
  { id: "ok-ship-1", scenario: "order update and split shipment", purchase: "ok-1", cls: "shipped", merchant: "Oakhaven Home", domain: "oakhaven.example", ref: "OK-100", date: "2026-10-03T10:00:00Z", items: [["Linen Throw", 1, 40]] },
  { id: "ok-ship-2", scenario: "order update and split shipment", purchase: "ok-1", cls: "shipped", merchant: "Oakhaven Home", domain: "oakhaven.example", ref: "OK-100", date: "2026-10-06T10:00:00Z", items: [["Candle Set", 1, 30]] },

  // Amazon-style name variants in two inboxes with the same order number.
  { id: "ebay-a", scenario: "name variants across inboxes", purchase: "ebay-1", merchant: "eBay", domain: "ebay.com", ref: "27-11223-44556", account: "acct-a", date: "2026-09-14T10:00:00Z", total: 31.25, items: [["Vintage Film Camera Strap", 1, 31.25]] },
  { id: "ebay-b", scenario: "name variants across inboxes", purchase: "ebay-1", merchant: "eBay Inc", domain: "ebay.co.uk", from: '"eBay" <ebay@ebay.co.uk>', ref: "27-11223-44556", account: "acct-b", date: "2026-09-14T10:02:00Z", total: 31.25, items: [["Vintage Film Camera Strap", 1, 31.25]] },

  // Platform-sent POS receipt (Taiwan, NT$ via a commerce platform): the shop is read from the name, not the domain.
  { id: "kor-a", scenario: "platform POS receipt (TWD)", purchase: "kor-1", merchant: "korea moos", domain: null, from: '"korea moos" <noreply@shoplineapp.com>', ref: "20260905001", currency: "TWD", date: "2026-09-05T12:10:00Z", total: 1280, items: [["Korean Skincare Set", 1, 1280]] },
  { id: "kor-a-resent", scenario: "platform POS receipt (TWD)", purchase: "kor-1", merchant: "korea moos", domain: null, from: '"korea moos" <noreply@shoplineapp.com>', ref: "20260905001", currency: "TWD", date: "2026-09-06T08:00:00Z", total: 1280, items: [["Korean Skincare Set", 1, 1280]] },
  { id: "kor-b", scenario: "platform POS receipt (TWD)", purchase: "kor-2", merchant: "korea moos", domain: null, from: '"korea moos" <noreply@shoplineapp.com>', ref: "20260912004", currency: "TWD", date: "2026-09-12T15:20:00Z", total: 1280, items: [["Korean Skincare Set", 1, 1280]] },
  { id: "tea-a", scenario: "platform POS receipt (TWD)", purchase: "tea-1", merchant: "Tea House Taipei", domain: null, from: '"Tea House Taipei" <noreply@shoplineapp.com>', ref: "20260905002", currency: "TWD", date: "2026-09-05T12:30:00Z", total: 1280, items: [["Oolong Tea Tin", 2, 640]] },

  // Shopify-sent sequence (real-inbox regression): confirmed -> on the way -> out for delivery -> delivered. The
  // shipment emails' extraction has a shipment id, nothing, or a tracking number as order ref and no merchant domain;
  // only the subject (and the platform's display name) say which order it is.
  { id: "blk-confirmed", scenario: "Shopify shipment sequence", purchase: "blk-9129", merchant: "Bowlish Keys", domain: "bowlish-keys.example", from: '"Bowlish Keys" <store@t.shopifyemail.com>', subject: "Order #BLK-9129 confirmed", ref: "BLK-9129", date: "2026-09-22T15:00:00Z", total: 66, items: [["Keycap Set", 1, 66]] },
  { id: "blk-on-the-way", scenario: "Shopify shipment sequence", purchase: "blk-9129", cls: "shipped", merchant: "Bowlish Keys", domain: null, from: '"Bowlish Keys" <store@t.shopifyemail.com>', subject: "A shipment from order #BLK-9129 is on the way", ref: "SHP-55321", date: "2026-09-23T09:00:00Z", total: 0 },
  { id: "blk-out-for-delivery", scenario: "Shopify shipment sequence", purchase: "blk-9129", cls: "shipped", merchant: null, domain: null, from: '"Bowlish Keys" <store@t.shopifyemail.com>', subject: "A shipment from order #BLK-9129 is out for delivery", ref: null, date: "2026-09-24T08:00:00Z" },
  { id: "blk-delivered", scenario: "Shopify shipment sequence", purchase: "blk-9129", cls: "delivered", merchant: "Bowlish Keys", domain: null, from: '"Bowlish Keys" <store@t.shopifyemail.com>', subject: "A shipment from order #BLK-9129 has been delivered", ref: "1Z999AA10123456784", date: "2026-09-25T14:00:00Z", total: 0 },

  // Same sequence where the subject does NOT carry the order number: a bare lifecycle email joins the merchant's only order.
  { id: "bare-order", scenario: "bare lifecycle email, only open order", purchase: "bare-1", merchant: "Tea House Taipei", domain: "teahouse.example", ref: "TH-4412", date: "2026-09-10T10:00:00Z", total: 30, items: [["Oolong Tin", 1, 30]] },
  { id: "bare-delivered", scenario: "bare lifecycle email, only open order", purchase: "bare-1", cls: "delivered", merchant: "Tea House Taipei", domain: "teahouse.example", subject: "Your package was delivered", ref: null, date: "2026-09-13T10:00:00Z" },

  // MUST NOT MERGE: two identical coffees the same day (no order numbers, identical text).
  { id: "coffee-am", scenario: "two identical coffees, same day", purchase: "coffee-am", ...BREWBOX, ref: null, messageId: "bb-am@brewbox.example", date: "2026-09-25T08:00:00Z", total: 4.5, items: [["Flat White", 1, 4.5]] },
  { id: "coffee-pm", scenario: "two identical coffees, same day", purchase: "coffee-pm", ...BREWBOX, ref: null, messageId: "bb-pm@brewbox.example", date: "2026-09-25T15:30:00Z", total: 4.5, items: [["Flat White", 1, 4.5]] },

  // MUST NOT MERGE: a monthly subscription (same plan number, same amount, every ~30 days).
  { id: "sub-sep", scenario: "monthly subscription", purchase: "sub-sep", merchant: "VoltLine Cloud", domain: "voltline.example", ref: "SUB-4455", date: "2026-08-01T06:00:00Z", total: 9.99, items: [["Cloud Storage 200GB", 1, 9.99]] },
  { id: "sub-oct", scenario: "monthly subscription", purchase: "sub-oct", merchant: "VoltLine Cloud", domain: "voltline.example", ref: "SUB-4455", date: "2026-09-01T06:00:00Z", total: 9.99, items: [["Cloud Storage 200GB", 1, 9.99]] },
  { id: "sub-nov", scenario: "monthly subscription", purchase: "sub-nov", merchant: "VoltLine Cloud", domain: "voltline.example", ref: "SUB-4455", date: "2026-10-01T06:00:00Z", total: 9.99, items: [["Cloud Storage 200GB", 1, 9.99]] },

  // MUST NOT MERGE: two orders, same merchant, same amount, same day, different order numbers.
  { id: "nw-order-5001", scenario: "same amount, different refs", purchase: "nw-5001", ...NORTHWIND, ref: "NW-5001", date: "2026-10-10T10:00:00Z", total: 60, items: [["Wool Socks", 2, 30]] },
  { id: "nw-order-5002", scenario: "same amount, different refs", purchase: "nw-5002", ...NORTHWIND, ref: "NW-5002", date: "2026-10-10T10:20:00Z", total: 60, items: [["Wool Socks", 2, 30]] },

  // MUST NOT MERGE: a refund bigger than the order total is not that order's refund (E: refund <= total).
  { id: "vl-order", scenario: "refund larger than the order", purchase: "vl-1", merchant: "VoltLine Electronics", domain: "voltline.example", ref: "VL-8801", date: "2026-10-05T10:00:00Z", total: 100, items: [["USB-C Dock", 1, 100]] },
  { id: "vl-big-refund", scenario: "refund larger than the order", purchase: "vl-other", cls: "refund", merchant: "VoltLine Electronics", domain: "voltline.example", ref: null, date: "2026-10-08T10:00:00Z", eventAmount: 101, items: [["USB-C Dock", 1, 101]] },

  // Forward that lost the order number (the numbered original is one day older, same items and total).
  { id: "oak-original", scenario: "forward without order number", purchase: "oak-fwd", merchant: "Oakhaven Books", domain: "oakhaven-books.example", ref: "OB-2210", date: "2026-10-14T09:00:00Z", total: 38, items: [["Hardcover Atlas", 1, 38]] },
  { id: "oak-forwarded", scenario: "forward without order number", purchase: "oak-fwd", merchant: "Oakhaven Books", domain: null, from: '"Sam Rivera" <sam.rivera@gmail.com>', subject: "Fwd: Thanks for your purchase", ref: null, messageId: "fwd-oak@gmail.example", date: "2026-10-15T07:00:00Z", total: 38, items: [["Hardcover Atlas", 1, 38]] },

  // MUST NOT MERGE: the same order number at two different stores.
  { id: "ref-clash-a", scenario: "same ref at different merchants", purchase: "clash-a", merchant: "Northwind Garden", domain: "northwind-garden.example", ref: "100234", date: "2026-10-16T10:00:00Z", total: 52, items: [["Garden Gloves", 1, 52]] },
  { id: "ref-clash-b", scenario: "same ref at different merchants", purchase: "clash-b", merchant: "Lumen Beauty", domain: "lumen-beauty.example", ref: "100234", date: "2026-10-16T10:30:00Z", total: 52, items: [["Face Cream", 1, 52]] },

  // MUST NOT MERGE: different stores, same amount, same day.
  { id: "mix-a", scenario: "different merchants, same amount", purchase: "mix-a", merchant: "Oakhaven Books", domain: "oakhaven-books.example", ref: null, date: "2026-10-11T10:00:00Z", total: 25, items: [["Paperback", 1, 25]] },
  { id: "mix-b", scenario: "different merchants, same amount", purchase: "mix-b", merchant: "Northwind Garden", domain: "northwind-garden.example", ref: null, date: "2026-10-11T10:30:00Z", total: 25, items: [["Seed Pack", 1, 25]] },
];

export function rawEmailOf(spec: DedupSpec): RawEmail {
  const domain = spec.domain ?? "shop.example";
  const itemLines = (spec.items ?? []).map(([name, qty, price]) => `${name} x${qty} ${price}`).join("\n");
  const text = spec.text ?? [spec.merchant ?? "", spec.ref ?? "", itemLines, spec.total !== undefined && spec.total !== null ? `Total ${spec.total}` : "", spec.eventAmount ? `Amount ${spec.eventAmount}` : ""].join("\n");
  return {
    id: spec.id,
    from: spec.from ?? `"${spec.merchant ?? domain}" <orders@${domain}>`,
    subject: spec.subject ?? `${spec.cls ?? "order"} ${spec.ref ?? ""}`.trim(),
    date: spec.date,
    text,
    ...(spec.messageId ? { messageId: spec.messageId } : {}),
    ...(spec.threadId ? { threadId: spec.threadId } : {}),
    ...(spec.account ? { sourceAccount: spec.account } : {}),
  };
}

export function extractionOf(spec: DedupSpec): Extraction {
  return {
    emailId: spec.id,
    class: spec.cls ?? "order",
    fields: {
      merchant: spec.merchant,
      merchantDomain: spec.domain ?? null,
      orderRef: spec.ref ?? null,
      ...(spec.otherRefs ? { otherRefs: spec.otherRefs } : {}),
      date: spec.date.slice(0, 10),
      currency: spec.currency ?? "USD",
      lineItems: (spec.items ?? []).map(([name, qty, unitPrice]) => ({ name, qty, unitPrice })),
      totals: spec.total !== undefined && spec.total !== null ? { total: spec.total } : {},
      ...(spec.eventAmount !== undefined ? { eventAmount: spec.eventAmount } : {}),
    },
    confidence: {},
    evidence: {},
    confMin: 0.95,
    model: "dedup-fixture",
    cached: false,
  };
}
