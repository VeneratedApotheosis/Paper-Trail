// Deterministic synthetic seed generator (issue #5). No randomness, no clock, no network.
// Everything here is fictional: stores use `.example` domains, the customer "Sam Rivera" does not exist,
// and card numbers are public Luhn-valid test numbers. Regenerate with:
//   $env:WRITE_SEED='1'; npx vitest run scripts/write-seed.test.ts
import type {
  EmailClass,
  ExpectedFinding,
  ExpectedFindingsFile,
  GoldLabel,
  GoldLabelsFile,
  RawEmail,
  SeedInbox,
} from "@/lib/contracts";
import { bazaarly, bazaarlyDeals, bazaarlySpanishReceipt } from "../seed/templates/bazaarly";
import { brewbox, brewboxPriceNotice } from "../seed/templates/brewbox";
import { freshcart } from "../seed/templates/freshcart";
import { forwardedGrandmartReceipt, grandmart } from "../seed/templates/grandmart";
import { lumenBeauty, lumenPointsNotice } from "../seed/templates/lumen-beauty";
import { northwind, northwindPhishing, northwindPromo } from "../seed/templates/northwind";
import { oakhaven } from "../seed/templates/oakhaven";
import {
  CUSTOMER,
  CUSTOMER_TO,
  effectivePolicy,
  isoDate,
  itemsFor,
  orderSnapshot,
  renderOrderEmail,
  subtotalOf,
  totalOf,
} from "../seed/templates/render";
import type {
  OrderEmailKind,
  SeedLineItem,
  SeedOrder,
  SeedOrderEmail,
  SeedStandaloneEmail,
  StoreTemplate,
} from "../seed/templates/types";
import { voltline } from "../seed/templates/voltline";

/** Fixed "today" of the seed scenario. Rules and eval run with now = SEED_AS_OF. */
export const SEED_AS_OF = "2026-10-17T19:00:00Z";

export const SEED_STORES: StoreTemplate[] = [
  bazaarly,
  grandmart,
  voltline,
  northwind,
  lumenBeauty,
  oakhaven,
  freshcart,
  brewbox,
];

export interface PriceObservation {
  merchant: string;
  sku: string;
  name: string;
  price: number;
  currency: string;
  observedAt: string;
}

export interface PriceFeed {
  simulated: true;
  observations: PriceObservation[];
}

export interface SeedFiles {
  inbox: SeedInbox;
  expectedFindings: ExpectedFindingsFile;
  goldLabels: GoldLabelsFile;
  priceFeed: PriceFeed;
}

const VISA = { cardBrand: "Visa", last4: "4242" };
const MASTERCARD = { cardBrand: "Mastercard", last4: "4444" };

function emailId(orderRef: string, kind: OrderEmailKind, suffix?: string): string {
  return `${orderRef.toLowerCase()}-${kind.replace(/_/g, "-")}${suffix ? `-${suffix}` : ""}`;
}

type EmailSpec = Omit<SeedOrderEmail, "id"> & { suffix?: string };

interface OrderSpec extends Omit<SeedOrder, "emails" | "tags" | "discount" | "shipping"> {
  discount?: number;
  shipping?: number;
  tags?: string[];
  emails: EmailSpec[];
}

function order(spec: OrderSpec): SeedOrder {
  const { emails, discount, shipping, tags, ...rest } = spec;
  return {
    ...rest,
    discount: discount ?? 0,
    shipping: shipping ?? 0,
    tags: tags ?? [],
    emails: emails.map(({ suffix, ...email }) => ({ ...email, id: emailId(spec.orderRef, email.kind, suffix) })),
  };
}

function item(name: string, sku: string, unitPrice: number, qty = 1, soldBy?: string): SeedLineItem {
  return soldBy ? { name, sku, qty, unitPrice, soldBy } : { name, sku, qty, unitPrice };
}

// ---------------------------------------------------------------------------------------------
// Orders. Times are UTC, chosen mid-day so the calendar date is unambiguous in any US timezone.
// ---------------------------------------------------------------------------------------------

export const seedOrders: SeedOrder[] = [
  // Northwind Outfitters (apparel): 30 days of delivery, refunds within 7 days, price adjust 14 days.
  order({
    store: northwind,
    orderRef: "NW-48213",
    placedAt: "2026-08-28T17:20:00Z",
    currency: "USD",
    ...VISA,
    items: [
      item("Trail Fleece Pullover", "NW-FLC-110", 79.0),
      item("Merino Crew Socks (3-pack)", "NW-SCK-031", 24.0),
    ],
    tax: 8.24,
    emails: [
      { kind: "order", at: "2026-08-28T17:20:00Z" },
      { kind: "delivered", at: "2026-09-01T18:05:00Z" },
      { kind: "return_started", at: "2026-09-20T16:40:00Z" },
      { kind: "return_received", at: "2026-10-03T15:10:00Z" },
    ],
  }),
  order({
    store: northwind,
    orderRef: "NW-49007",
    placedAt: "2026-09-15T16:00:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Canvas Chore Jacket", "NW-JKT-CHR", 98.0)],
    tax: 7.84,
    emails: [
      { kind: "order", at: "2026-09-15T16:00:00Z" },
      { kind: "shipped", at: "2026-09-16T20:15:00Z" },
      { kind: "delivered", at: "2026-09-19T15:00:00Z" },
    ],
  }),
  order({
    store: northwind,
    orderRef: "NW-49388",
    placedAt: "2026-09-20T19:30:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Clearance Rain Shell", "NW-RSH-CLR", 39.0)],
    tax: 3.12,
    policy: { finalSaleText: "FINAL SALE: clearance items cannot be returned or exchanged." },
    tags: ["final_sale"],
    emails: [{ kind: "order", at: "2026-09-20T19:30:00Z" }],
  }),
  order({
    store: northwind,
    orderRef: "NW-50112",
    placedAt: "2026-10-05T17:00:00Z",
    currency: "USD",
    ...VISA,
    items: [
      item("Ridgeline Down Jacket", "NW-JKT-RDG", 189.0),
      item("Heavyweight Pocket Tee", "NW-TEE-HVY", 28.0),
    ],
    tax: 17.36,
    emails: [
      { kind: "order", at: "2026-10-05T17:00:00Z" },
      { kind: "delivered", at: "2026-10-08T18:30:00Z" },
    ],
  }),

  // Voltline Electronics: 30 days of delivery, no refund SLA stated, price adjust 14 days.
  order({
    store: voltline,
    orderRef: "VL-77120",
    placedAt: "2026-08-30T18:45:00Z",
    currency: "USD",
    ...MASTERCARD,
    items: [
      item("Arc Noise-Cancelling Headphones", "VL-HP-900", 150.0),
      item("Pulse 65W USB-C Charger", "VL-CHG-65", 50.0),
    ],
    tax: 18.0,
    tags: ["partial_return"],
    emails: [
      { kind: "order", at: "2026-08-30T18:45:00Z" },
      { kind: "delivered", at: "2026-09-03T17:30:00Z" },
      { kind: "return_started", at: "2026-09-22T15:00:00Z", items: [{ sku: "VL-HP-900", qty: 1 }] },
      { kind: "return_received", at: "2026-09-28T16:00:00Z", items: [{ sku: "VL-HP-900", qty: 1 }] },
    ],
  }),
  order({
    store: voltline,
    orderRef: "VL-78455",
    placedAt: "2026-09-17T16:10:00Z",
    currency: "USD",
    ...MASTERCARD,
    items: [item('Lumi 27" 4K Monitor', "VL-MON-27K", 329.99)],
    tax: 29.7,
    emails: [
      { kind: "order", at: "2026-09-17T16:10:00Z" },
      { kind: "shipped", at: "2026-09-18T21:00:00Z" },
      { kind: "delivered", at: "2026-09-21T17:00:00Z" },
    ],
  }),
  order({
    store: voltline,
    orderRef: "VL-80231",
    placedAt: "2026-10-08T17:00:00Z",
    currency: "USD",
    ...MASTERCARD,
    items: [item("Echo Mini Smart Speaker", "VL-SPK-200", 129.99)],
    tax: 11.7,
    emails: [
      { kind: "order", at: "2026-10-08T17:00:00Z" },
      { kind: "delivered", at: "2026-10-10T19:20:00Z" },
    ],
  }),
  order({
    store: voltline,
    orderRef: "VL-CA-30418",
    placedAt: "2026-08-10T15:30:00Z",
    currency: "CAD",
    ...VISA,
    items: [item("Glide Wireless Mouse", "VL-MSE-310", 49.99)],
    tax: 6.5,
    tags: ["multi_currency"],
    emails: [
      { kind: "order", at: "2026-08-10T15:30:00Z", note: "Voltline Canada: all prices are in Canadian dollars (CAD)." },
      { kind: "delivered", at: "2026-08-14T18:00:00Z" },
    ],
  }),

  // Grandmart (big-box): 90 days of purchase, refunds within 5 days, price adjust 14 days.
  order({
    store: grandmart,
    orderRef: "GM-2210-5531",
    placedAt: "2026-08-15T19:00:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Cordless Stick Vacuum", "GM-VAC-220", 179.0)],
    tax: 14.77,
    emails: [
      { kind: "order", at: "2026-08-15T19:00:00Z" },
      { kind: "return_dropped", at: "2026-09-30T17:00:00Z" },
      { kind: "return_received", at: "2026-10-06T14:30:00Z" },
    ],
  }),
  order({
    store: grandmart,
    orderRef: "GM-2210-6104",
    placedAt: "2026-07-22T18:00:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Air Fryer, 6 qt", "GM-AF-600", 89.99), item("Bath Towel Set (4-pack)", "GM-TWL-4PK", 34.0)],
    tax: 10.23,
    emails: [
      { kind: "order", at: "2026-07-22T18:00:00Z" },
      { kind: "delivered", at: "2026-07-25T16:00:00Z" },
    ],
  }),
  order({
    store: grandmart,
    orderRef: "GM-2210-7789",
    placedAt: "2026-10-09T16:00:00Z",
    currency: "USD",
    ...VISA,
    items: [
      item("Ceramic Nonstick Pan, 10 in", "GM-PAN-10", 34.99, 2),
      item("Silicone Utensil Set", "GM-UTN-5", 12.99),
    ],
    tax: 6.85,
    emails: [
      { kind: "order", at: "2026-10-09T16:00:00Z" },
      { kind: "shipped", at: "2026-10-10T15:00:00Z" },
    ],
  }),
  order({
    store: grandmart,
    orderRef: "GM-2210-8820",
    placedAt: "2026-08-20T20:00:00Z",
    currency: "USD",
    cardBrand: "Visa debit",
    last4: "5556",
    items: [
      item("Adjustable Desk Lamp", "GM-LMP-ADJ", 24.99),
      item("Storage Bins (3-pack)", "GM-BIN-3PK", 18.0),
    ],
    tax: 3.55,
    tags: ["forwarded"],
    emails: [
      {
        kind: "order",
        at: "2026-08-21T14:00:00Z",
        fullCardNumber: "4000 0566 5566 5556",
        render: forwardedGrandmartReceipt,
      },
    ],
  }),
  order({
    store: grandmart,
    orderRef: "GM-2210-9350",
    placedAt: "2026-10-02T18:00:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Robot Vacuum", "GM-RBV-100", 149.0)],
    tax: 12.29,
    tags: ["cancel_before_ship"],
    emails: [
      { kind: "order", at: "2026-10-02T18:00:00Z" },
      { kind: "cancel", at: "2026-10-03T15:00:00Z" },
    ],
  }),
  order({
    store: grandmart,
    orderRef: "GM-2210-4470",
    placedAt: "2026-08-01T17:00:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Memory Foam Pillow (2-pack)", "GM-PIL-2PK", 45.0)],
    tax: 3.71,
    tags: ["refund_matched"],
    emails: [
      { kind: "order", at: "2026-08-01T17:00:00Z" },
      { kind: "return_received", at: "2026-08-20T16:00:00Z" },
      { kind: "refund", at: "2026-08-23T18:00:00Z", amount: 48.71 },
    ],
  }),

  // Lumen Beauty: 60 days of purchase, refunds within 14 days, no price-adjust policy.
  order({
    store: lumenBeauty,
    orderRef: "LB-60455",
    placedAt: "2026-08-05T16:00:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Hydra Cream 50 ml", "LB-CRM-50", 24.0, 2), item("Glow Serum 30 ml", "LB-SER-30", 24.0, 2)],
    tax: 8.4,
    tags: ["partial_return", "short_refund"],
    emails: [
      { kind: "order", at: "2026-08-05T16:00:00Z" },
      { kind: "return_started", at: "2026-09-08T17:00:00Z", items: [{ sku: "LB-SER-30", qty: 2 }] },
      { kind: "return_received", at: "2026-09-15T15:00:00Z", items: [{ sku: "LB-SER-30", qty: 2 }] },
      { kind: "refund", at: "2026-09-22T16:00:00Z", amount: 48.0 },
    ],
  }),
  order({
    store: lumenBeauty,
    orderRef: "LB-62310",
    placedAt: "2026-08-23T15:00:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Peptide Night Cream", "LB-NCR-50", 58.0), item("Mineral SPF 50", "LB-SPF-50", 32.0)],
    tax: 7.88,
    emails: [
      { kind: "order", at: "2026-08-23T15:00:00Z" },
      { kind: "shipped", at: "2026-08-24T18:00:00Z" },
    ],
  }),
  order({
    store: lumenBeauty,
    orderRef: "LB-63118",
    placedAt: "2026-09-01T17:00:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Rose Clay Mask", "LB-MSK-RC", 36.0)],
    tax: 3.15,
    tags: ["refund_pending_not_due"],
    emails: [
      { kind: "order", at: "2026-09-01T17:00:00Z" },
      { kind: "return_received", at: "2026-10-09T16:00:00Z" },
    ],
  }),

  // Oakhaven Home (furniture): 30 days of delivery, refunds within 10 days.
  order({
    store: oakhaven,
    orderRef: "OH-11842",
    placedAt: "2026-09-12T18:00:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Linen Accent Chair", "OH-CHR-LIN", 349.0)],
    shipping: 49.0,
    tax: 30.54,
    emails: [
      { kind: "order", at: "2026-09-12T18:00:00Z" },
      { kind: "shipped", at: "2026-09-18T15:00:00Z" },
      { kind: "delivered", at: "2026-09-23T16:00:00Z" },
    ],
  }),
  order({
    store: oakhaven,
    orderRef: "OH-11590",
    placedAt: "2026-08-18T17:00:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Walnut Dining Table", "OH-TBL-WAL", 899.0), item("Dining Chair", "OH-CHR-DIN", 129.0, 4)],
    tax: 123.81,
    tags: ["split_shipment"],
    emails: [
      { kind: "order", at: "2026-08-18T17:00:00Z" },
      {
        kind: "shipped",
        suffix: "1",
        at: "2026-08-20T15:00:00Z",
        items: [{ sku: "OH-TBL-WAL", qty: 1 }],
        shipment: { index: 1, count: 2 },
      },
      {
        kind: "delivered",
        suffix: "1",
        at: "2026-08-25T18:00:00Z",
        items: [{ sku: "OH-TBL-WAL", qty: 1 }],
        shipment: { index: 1, count: 2 },
      },
      {
        kind: "shipped",
        suffix: "2",
        at: "2026-08-27T16:00:00Z",
        items: [{ sku: "OH-CHR-DIN", qty: 4 }],
        shipment: { index: 2, count: 2 },
      },
      {
        kind: "delivered",
        suffix: "2",
        at: "2026-09-02T17:00:00Z",
        items: [{ sku: "OH-CHR-DIN", qty: 4 }],
        shipment: { index: 2, count: 2 },
      },
    ],
  }),
  order({
    store: oakhaven,
    orderRef: "OH-12007",
    placedAt: "2026-08-26T16:30:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Arched Floor Lamp", "OH-LMP-ARC", 240.0)],
    tax: 21.0,
    tags: ["short_refund"],
    emails: [
      { kind: "order", at: "2026-08-26T16:30:00Z" },
      { kind: "delivered", at: "2026-09-04T18:00:00Z" },
      { kind: "return_received", at: "2026-09-24T15:00:00Z" },
      { kind: "refund", at: "2026-10-01T17:00:00Z", amount: 240.0 },
    ],
  }),

  // Bazaarly (marketplace): 30 days of delivery; no refund SLA or price-adjust policy stated.
  order({
    store: bazaarly,
    orderRef: "BZ-114-2290417",
    placedAt: "2026-09-02T19:10:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Electric Gooseneck Kettle", "BZ-KTL-GN", 64.99, 1, "Kettle & Co. (third-party seller)")],
    tax: 5.36,
    emails: [
      { kind: "order", at: "2026-09-02T19:10:00Z" },
      { kind: "delivered", at: "2026-09-06T17:00:00Z" },
      { kind: "return_dropped", at: "2026-09-24T16:00:00Z" },
    ],
  }),
  order({
    store: bazaarly,
    orderRef: "BZ-114-3381025",
    placedAt: "2026-08-12T18:00:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Bamboo Cutting Board Set", "BZ-CBD-BMB", 35.9, 1, "Bazaarly")],
    tax: 2.96,
    tags: ["store_credit"],
    emails: [
      { kind: "order", at: "2026-08-12T18:00:00Z" },
      { kind: "delivered", at: "2026-08-15T16:00:00Z" },
      { kind: "return_received", at: "2026-09-05T15:00:00Z" },
      { kind: "store_credit", at: "2026-09-08T17:00:00Z", amount: 38.86 },
    ],
  }),
  order({
    store: bazaarly,
    orderRef: "BZ-114-4410938",
    placedAt: "2026-09-28T18:00:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Juego de sábanas de algodón (Queen)", "BZ-SAB-Q", 42.4, 1, "Casa Lino (vendedor externo)")],
    tax: 3.5,
    tags: ["non_english"],
    emails: [{ kind: "order", at: "2026-09-28T18:00:00Z", render: (o) => bazaarlySpanishReceipt(o) }],
  }),
  order({
    store: bazaarly,
    orderRef: "BZ-114-5523301",
    placedAt: "2026-10-01T16:00:00Z",
    currency: "USD",
    ...VISA,
    items: [item("Mesh Desk Organizer", "BZ-ORG-MSH", 19.99, 1, "Bazaarly")],
    tax: 1.65,
    tags: ["duplicate_order"],
    emails: [
      {
        kind: "order",
        at: "2026-10-01T16:00:00Z",
        snapshot: { items: [item("Mesh Desk Organizer", "BZ-ORG-MSH", 19.99, 2, "Bazaarly")], tax: 3.3, shipping: 0, discount: 0 },
      },
      {
        kind: "order_resent",
        at: "2026-10-01T16:20:00Z",
        snapshot: { items: [item("Mesh Desk Organizer", "BZ-ORG-MSH", 19.99, 2, "Bazaarly")], tax: 3.3, shipping: 0, discount: 0 },
      },
      { kind: "order_updated", at: "2026-10-02T15:00:00Z", tags: ["updated_order"] },
    ],
  }),

  // FreshCart Grocery: perishables are final sale; delivery fee shown as shipping.
  order({
    store: freshcart,
    orderRef: "FC-90311",
    placedAt: "2026-09-27T20:00:00Z",
    currency: "USD",
    ...MASTERCARD,
    items: [
      item("Organic Bananas (bunch)", "FC-PRD-BAN", 2.49),
      item("Whole Milk (1 gal)", "FC-DRY-MLK", 4.29),
      item("Sourdough Loaf", "FC-BKY-SDL", 5.49),
      item("Free-Range Eggs (dozen)", "FC-DRY-EGG", 4.99),
    ],
    shipping: 3.99,
    tax: 0,
    tags: ["final_sale"],
    emails: [{ kind: "order", at: "2026-09-27T20:00:00Z", fullCardNumber: "5555 5555 5555 4444" }],
  }),
  order({
    store: freshcart,
    orderRef: "FC-90477",
    placedAt: "2026-10-04T19:00:00Z",
    currency: "USD",
    ...MASTERCARD,
    items: [
      item("Baby Spinach (5 oz)", "FC-PRD-SPN", 3.99),
      item("Sourdough Loaf", "FC-BKY-SDL", 5.49),
      item("Greek Yogurt (32 oz)", "FC-DRY-YGT", 5.79),
    ],
    shipping: 3.99,
    tax: 0,
    tags: ["final_sale"],
    emails: [
      { kind: "order", at: "2026-10-04T19:00:00Z" },
      {
        kind: "refund",
        at: "2026-10-05T15:00:00Z",
        amount: 5.49,
        note: "Your Sourdough Loaf (SKU FC-BKY-SDL) was missing from your delivery, so we refunded it. No return is needed.",
        tags: ["refund_without_return"],
      },
    ],
  }),
  order({
    store: freshcart,
    orderRef: "FC-90652",
    placedAt: "2026-10-11T21:00:00Z",
    currency: "USD",
    ...MASTERCARD,
    items: [
      item("Honeycrisp Apples (3 lb)", "FC-PRD-APL", 6.99),
      item("Whole Milk (1 gal)", "FC-DRY-MLK", 4.29),
      item("Ground Coffee (12 oz)", "FC-PAN-COF", 8.49),
    ],
    shipping: 3.99,
    tax: 0,
    tags: ["final_sale"],
    emails: [{ kind: "order", at: "2026-10-11T21:00:00Z" }],
  }),

  // Brewbox Coffee (DTC subscription): monthly renewals with a subscriber discount; final sale.
  ...[
    { orderRef: "BB-SUB-20817", at: "2026-08-03T14:00:00Z" },
    { orderRef: "BB-SUB-21544", at: "2026-09-03T14:00:00Z" },
    { orderRef: "BB-SUB-22391", at: "2026-10-03T14:00:00Z", shippedAt: "2026-10-04T16:00:00Z" },
  ].map(({ orderRef, at, shippedAt }) =>
    order({
      store: brewbox,
      orderRef,
      placedAt: at,
      currency: "USD",
      ...MASTERCARD,
      items: [item("Single Origin Coffee, 2 x 12 oz", "BB-SO-2X12", 18.0)],
      discount: 1.8,
      tax: 0,
      tags: ["subscription_renewal", "discount", "final_sale"],
      emails: [
        { kind: "order", at },
        ...(shippedAt ? [{ kind: "shipped" as const, at: shippedAt }] : []),
      ],
    }),
  ),
];

// ---------------------------------------------------------------------------------------------
// Emails not tied to an order.
// ---------------------------------------------------------------------------------------------

const PROMOTIONS = ["INBOX", "CATEGORY_PROMOTIONS"];

export const standaloneEmails: SeedStandaloneEmail[] = [
  {
    id: "northwind-promo-fall-markdowns",
    at: "2026-10-14T14:00:00Z",
    rendered: northwindPromo(),
    class: "marketing",
    merchant: northwind.name,
    merchantDomain: northwind.domain,
    labels: PROMOTIONS,
    tags: ["marketing_not_order", "price_drop_promo"],
  },
  {
    id: "phish-n0rthwind-verify-card",
    at: "2026-10-15T21:12:00Z",
    rendered: northwindPhishing(),
    class: "not_receipt",
    merchant: null,
    merchantDomain: null,
    labels: ["INBOX"],
    tags: ["phishing_lookalike"],
  },
  {
    id: "lumen-points-balance",
    at: "2026-10-12T15:00:00Z",
    rendered: lumenPointsNotice(),
    class: "not_receipt",
    merchant: lumenBeauty.name,
    merchantDomain: lumenBeauty.domain,
    labels: ["INBOX", "CATEGORY_UPDATES"],
    tags: ["points_balance"],
  },
  {
    id: "bazaarly-daily-deals",
    at: "2026-10-13T15:00:00Z",
    rendered: bazaarlyDeals(),
    class: "marketing",
    merchant: bazaarly.name,
    merchantDomain: bazaarly.domain,
    labels: PROMOTIONS,
    tags: ["marketing_not_order"],
  },
  {
    id: "brewbox-price-notice",
    at: "2026-10-10T15:00:00Z",
    rendered: brewboxPriceNotice(),
    class: "not_receipt",
    merchant: brewbox.name,
    merchantDomain: brewbox.domain,
    labels: ["INBOX", "CATEGORY_UPDATES"],
    tags: ["account_notice"],
  },
];

// ---------------------------------------------------------------------------------------------
// Simulated price feed (R3). Only the three scripted drops may fire at SEED_AS_OF.
// ---------------------------------------------------------------------------------------------

function obs(store: StoreTemplate, sku: string, name: string, price: number, observedAt: string): PriceObservation {
  return { merchant: store.name, sku, name, price, currency: "USD", observedAt };
}

export const priceObservations: PriceObservation[] = [
  // Drop inside the 14-day window: fires (189.00 -> 149.00).
  obs(northwind, "NW-JKT-RDG", "Ridgeline Down Jacket", 189.0, "2026-09-30T12:00:00Z"),
  obs(northwind, "NW-JKT-RDG", "Ridgeline Down Jacket", 149.0, "2026-10-14T12:00:00Z"),
  // Dipped, then recovered: latest observation equals the paid price, no drop.
  obs(northwind, "NW-TEE-HVY", "Heavyweight Pocket Tee", 28.0, "2026-10-01T12:00:00Z"),
  obs(northwind, "NW-TEE-HVY", "Heavyweight Pocket Tee", 18.0, "2026-10-10T12:00:00Z"),
  obs(northwind, "NW-TEE-HVY", "Heavyweight Pocket Tee", 28.0, "2026-10-15T12:00:00Z"),
  // Drop inside window: fires (129.99 -> 99.99). The 89.99 observation is after asOf and must be ignored.
  obs(voltline, "VL-SPK-200", "Echo Mini Smart Speaker", 129.99, "2026-10-02T12:00:00Z"),
  obs(voltline, "VL-SPK-200", "Echo Mini Smart Speaker", 99.99, "2026-10-13T12:00:00Z"),
  obs(voltline, "VL-SPK-200", "Echo Mini Smart Speaker", 89.99, "2026-10-20T12:00:00Z"),
  // Big drop, but the order's 14-day window closed on 2026-10-01: no finding.
  obs(voltline, "VL-MON-27K", 'Lumi 27" 4K Monitor', 329.99, "2026-10-01T12:00:00Z"),
  obs(voltline, "VL-MON-27K", 'Lumi 27" 4K Monitor', 279.99, "2026-10-12T12:00:00Z"),
  // Drop inside window: fires ((34.99 - 27.99) x 2).
  obs(grandmart, "GM-PAN-10", "Ceramic Nonstick Pan, 10 in", 34.99, "2026-10-01T12:00:00Z"),
  obs(grandmart, "GM-PAN-10", "Ceramic Nonstick Pan, 10 in", 27.99, "2026-10-15T12:00:00Z"),
  // Drop below threshold ($1.00 < $5.00): no finding.
  obs(grandmart, "GM-UTN-5", "Silicone Utensil Set", 12.99, "2026-10-01T12:00:00Z"),
  obs(grandmart, "GM-UTN-5", "Silicone Utensil Set", 11.99, "2026-10-15T12:00:00Z"),
  // Window long closed (placed 2026-08-23): no finding.
  obs(lumenBeauty, "LB-NCR-50", "Peptide Night Cream", 58.0, "2026-09-01T12:00:00Z"),
  obs(lumenBeauty, "LB-NCR-50", "Peptide Night Cream", 42.0, "2026-10-01T12:00:00Z"),
  // Price went up: no finding.
  obs(oakhaven, "OH-CHR-LIN", "Linen Accent Chair", 379.0, "2026-10-05T12:00:00Z"),
];

// ---------------------------------------------------------------------------------------------
// Ground truth findings at SEED_AS_OF. Amounts are hand-computed; scripts/seed.test.ts recomputes them
// from the order data with an independent implementation of rules R1-R3 and checks nothing else fires.
// ---------------------------------------------------------------------------------------------

export const expectedFindings: ExpectedFinding[] = [
  {
    kind: "refund_overdue",
    merchant: northwind.name,
    orderRef: "NW-48213",
    amountAtStake: 111.24,
    dueDate: "2026-10-10",
    messageIds: ["nw-48213-order", "nw-48213-return-started", "nw-48213-return-received"],
    note: "Return received 2026-10-03 (strong trigger); stated SLA 'Refunds are issued within 7 days of receiving your return.' -> expected by 2026-10-10. No refund or store credit since. Whole order returned -> expected = order total $111.24.",
  },
  {
    kind: "refund_overdue",
    merchant: voltline.name,
    orderRef: "VL-77120",
    amountAtStake: 163.5,
    dueDate: "2026-10-08",
    messageIds: ["vl-77120-order", "vl-77120-return-started", "vl-77120-return-received"],
    note: "Partial return: headphones $150.00 of $200.00 subtotal. Return received 2026-09-28 (strong); no SLA stated -> default 10 days -> 2026-10-08. Expected = 150.00 + 18.00 tax x 150/200 = 150.00 + 13.50 = $163.50.",
  },
  {
    kind: "refund_overdue",
    merchant: bazaarly.name,
    orderRef: "BZ-114-2290417",
    amountAtStake: 70.35,
    dueDate: "2026-10-08",
    messageIds: ["bz-114-2290417-order", "bz-114-2290417-return-dropped"],
    note: "Return dropped off 2026-09-24 (weak trigger, no received email); no SLA stated -> default 14 days -> 2026-10-08. Whole order returned -> expected = order total $70.35.",
  },
  {
    kind: "refund_overdue",
    merchant: grandmart.name,
    orderRef: "GM-2210-5531",
    amountAtStake: 193.77,
    dueDate: "2026-10-11",
    messageIds: ["gm-2210-5531-order", "gm-2210-5531-return-dropped", "gm-2210-5531-return-received"],
    note: "Return received 2026-10-06 (strong trigger beats the 2026-09-30 drop-off); stated SLA 5 days -> expected by 2026-10-11. Whole order returned -> expected = order total $193.77.",
  },
  {
    kind: "refund_short",
    merchant: oakhaven.name,
    orderRef: "OH-12007",
    amountAtStake: 21.0,
    messageIds: ["oh-12007-order", "oh-12007-return-received", "oh-12007-refund"],
    note: "Whole order returned -> expected = order total $261.00 (240.00 + 21.00 tax, free shipping). Refund issued 2026-10-01 was $240.00, short by $21.00 (tolerance max(0.50, 2% = 5.22)).",
  },
  {
    kind: "refund_short",
    merchant: lumenBeauty.name,
    orderRef: "LB-60455",
    amountAtStake: 4.2,
    messageIds: ["lb-60455-order", "lb-60455-return-received", "lb-60455-refund"],
    note: "Partial return: 2 x Glow Serum = $48.00 of $96.00 subtotal. Expected = 48.00 + 8.40 tax x 48/96 = $52.20. Refund issued 2026-09-22 was $48.00, short by $4.20 (tolerance max(0.50, 2% = 1.04)).",
  },
  {
    kind: "return_deadline",
    merchant: northwind.name,
    orderRef: "NW-49007",
    amountAtStake: 105.84,
    dueDate: "2026-10-19",
    messageIds: ["nw-49007-order", "nw-49007-delivered"],
    note: "'Returns accepted within 30 days of delivery.' Delivered 2026-09-19 -> deadline 2026-10-19, 1.8 days after asOf. No return events. Amount = order total.",
  },
  {
    kind: "return_deadline",
    merchant: voltline.name,
    orderRef: "VL-78455",
    amountAtStake: 359.69,
    dueDate: "2026-10-21",
    messageIds: ["vl-78455-order", "vl-78455-delivered"],
    note: "'Returns accepted within 30 days of delivery.' Delivered 2026-09-21 -> deadline 2026-10-21, 3.9 days after asOf (an order-date anchor would have expired 2026-10-17). Amount = order total.",
  },
  {
    kind: "return_deadline",
    merchant: grandmart.name,
    orderRef: "GM-2210-6104",
    amountAtStake: 134.22,
    dueDate: "2026-10-20",
    messageIds: ["gm-2210-6104-order"],
    note: "'Returns accepted within 90 days of purchase.' Placed 2026-07-22 -> deadline 2026-10-20, 3.0 days after asOf (anchor is purchase, not the 2026-07-25 delivery). Amount = order total.",
  },
  {
    kind: "return_deadline",
    merchant: lumenBeauty.name,
    orderRef: "LB-62310",
    amountAtStake: 97.88,
    dueDate: "2026-10-22",
    messageIds: ["lb-62310-order"],
    note: "'Returns accepted within 60 days of purchase.' Placed 2026-08-23 -> deadline 2026-10-22, 4.8 days after asOf. No return events. Amount = order total.",
  },
  {
    kind: "return_deadline",
    merchant: oakhaven.name,
    orderRef: "OH-11842",
    amountAtStake: 428.54,
    dueDate: "2026-10-23",
    messageIds: ["oh-11842-order", "oh-11842-delivered"],
    note: "'Returns accepted within 30 days of delivery.' Delivered 2026-09-23 -> deadline 2026-10-23, 5.9 days after asOf. Amount = order total incl. $49.00 shipping.",
  },
  {
    kind: "price_drop",
    merchant: voltline.name,
    orderRef: "VL-80231",
    lineItem: "Echo Mini Smart Speaker",
    amountAtStake: 30.0,
    dueDate: "2026-10-22",
    messageIds: ["vl-80231-order"],
    note: "Paid $129.99 on 2026-10-08; simulated feed shows $99.99 on 2026-10-13 (the $89.99 point is dated after asOf and ignored). Drop = 30.00 x 1 >= max(5, 6.50). 'Price adjustments within 14 days of purchase.' -> by 2026-10-22.",
  },
  {
    kind: "price_drop",
    merchant: grandmart.name,
    orderRef: "GM-2210-7789",
    lineItem: "Ceramic Nonstick Pan, 10 in",
    amountAtStake: 14.0,
    dueDate: "2026-10-23",
    messageIds: ["gm-2210-7789-order"],
    note: "Paid $34.99 x 2 on 2026-10-09; simulated feed shows $27.99 on 2026-10-15. Drop = 7.00 x 2 = $14.00 >= max(5, 3.50). 14-day window -> by 2026-10-23. Utensil set dropped only $1.00 (below threshold).",
  },
  {
    kind: "price_drop",
    merchant: northwind.name,
    orderRef: "NW-50112",
    lineItem: "Ridgeline Down Jacket",
    amountAtStake: 40.0,
    dueDate: "2026-10-19",
    messageIds: ["nw-50112-order", "northwind-promo-fall-markdowns"],
    note: "Paid $189.00 on 2026-10-05; simulated feed and the 2026-10-14 promo email show $149.00. Drop = $40.00 >= max(5, 9.45). 14-day window -> by 2026-10-19. The pocket tee dipped to $18 but is back at $28.",
  },
];

// ---------------------------------------------------------------------------------------------
// Assembly: inbox + gold labels.
// ---------------------------------------------------------------------------------------------

const CLASS_BY_KIND: Record<OrderEmailKind, EmailClass> = {
  order: "order",
  order_resent: "order",
  order_updated: "order",
  shipped: "shipped",
  delivered: "delivered",
  return_started: "return_started",
  return_dropped: "return_started",
  return_received: "return_received",
  refund: "refund",
  store_credit: "refund",
  cancel: "cancel",
};

function goldLineItems(items: SeedLineItem[]) {
  return items.map(({ name, sku, qty, unitPrice }) => ({ name, sku, qty, unitPrice }));
}

function goldFieldsForOrderEmail(order: SeedOrder, email: SeedOrderEmail): GoldLabel["fields"] {
  const policy = effectivePolicy(order);
  const finalSale = Boolean(policy.finalSaleText);
  const base: GoldLabel["fields"] = {
    merchant: order.store.name,
    merchantDomain: order.store.domain,
    orderRef: order.orderRef,
    currency: order.currency,
  };
  switch (email.kind) {
    case "order":
    case "order_resent":
    case "order_updated": {
      const snapshot = email.kind === "order_updated" ? orderSnapshot(order) : (email.snapshot ?? orderSnapshot(order));
      return {
        ...base,
        date: isoDate(order.placedAt),
        lineItems: goldLineItems(snapshot.items),
        totals: {
          subtotal: subtotalOf(snapshot.items),
          tax: snapshot.tax,
          shipping: snapshot.shipping,
          ...(snapshot.discount > 0 ? { discount: snapshot.discount } : {}),
          total: totalOf(snapshot),
        },
        last4: order.last4,
        customerName: CUSTOMER.name,
        returnWindowDays: finalSale ? null : (policy.returnWindowDays ?? null),
        refundSlaDays: finalSale ? null : (policy.refundSlaDays ?? null),
        priceAdjustDays: finalSale ? null : (policy.priceAdjustDays ?? null),
      };
    }
    case "shipped":
      return { ...base, date: isoDate(email.at) };
    case "delivered":
      return { ...base, date: isoDate(email.at), returnWindowDays: finalSale ? null : (policy.returnWindowDays ?? null) };
    case "return_started":
    case "return_dropped":
    case "return_received":
      return {
        ...base,
        date: isoDate(email.at),
        lineItems: goldLineItems(itemsFor(order, email.items)),
        refundSlaDays: policy.refundSlaDays ?? null,
      };
    case "refund":
      return { ...base, date: isoDate(email.at), eventAmount: email.amount, last4: order.last4, isStoreCredit: false };
    case "store_credit":
      return { ...base, date: isoDate(email.at), eventAmount: email.amount, isStoreCredit: true };
    case "cancel":
      return { ...base, date: isoDate(email.at), last4: order.last4 };
  }
}

interface AssembledEmail {
  raw: RawEmail;
  label: Omit<GoldLabel, "holdout">;
}

function assembleOrderEmails(): AssembledEmail[] {
  return seedOrders.flatMap((order) =>
    order.emails.map((email) => {
      const rendered = renderOrderEmail(order, email);
      const raw: RawEmail = {
        id: email.id,
        threadId: `thread-${order.orderRef.toLowerCase()}`,
        from: rendered.from,
        to: rendered.to ?? CUSTOMER_TO,
        subject: rendered.subject,
        date: email.at,
        text: rendered.text,
        labels: ["INBOX", "CATEGORY_UPDATES"],
      };
      return {
        raw,
        label: {
          emailId: email.id,
          class: CLASS_BY_KIND[email.kind],
          fields: goldFieldsForOrderEmail(order, email),
          tags: [...order.tags, ...(email.tags ?? [])],
        },
      };
    }),
  );
}

function assembleStandaloneEmails(): AssembledEmail[] {
  return standaloneEmails.map((email) => ({
    raw: {
      id: email.id,
      threadId: `thread-${email.id}`,
      from: email.rendered.from,
      to: email.rendered.to ?? CUSTOMER_TO,
      subject: email.rendered.subject,
      date: email.at,
      text: email.rendered.text,
      labels: email.labels,
    },
    label: {
      emailId: email.id,
      class: email.class,
      fields: email.merchant ? { merchant: email.merchant, merchantDomain: email.merchantDomain } : {},
      tags: email.tags,
    },
  }));
}

/** Every 5th email (sorted by date) starting at index 2 is held out from prompt tuning, capped at 15. */
const HOLDOUT_COUNT = 15;
function isHoldout(index: number): boolean {
  return index % 5 === 2 && Math.floor(index / 5) < HOLDOUT_COUNT;
}

function byDateThenId(a: AssembledEmail, b: AssembledEmail): number {
  return a.raw.date.localeCompare(b.raw.date) || a.raw.id.localeCompare(b.raw.id);
}

export function buildSeed(): SeedFiles {
  const assembled = [...assembleOrderEmails(), ...assembleStandaloneEmails()].sort(byDateThenId);
  return {
    inbox: { synthetic: true, asOf: SEED_AS_OF, emails: assembled.map((entry) => entry.raw) },
    expectedFindings: { asOf: SEED_AS_OF, findings: expectedFindings },
    goldLabels: {
      labels: assembled.map((entry, index) => ({ ...entry.label, holdout: isHoldout(index) })),
    },
    priceFeed: { simulated: true, observations: priceObservations },
  };
}

/** Committed file paths (relative to the repo root) and their exact JSON contents. */
export function seedFileContents(): Record<string, string> {
  const seed = buildSeed();
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  return {
    "seed/inbox.json": json(seed.inbox),
    "seed/expected_findings.json": json(seed.expectedFindings),
    "seed/gold_labels.json": json(seed.goldLabels),
    "seed/price-feed.json": json(seed.priceFeed),
  };
}
