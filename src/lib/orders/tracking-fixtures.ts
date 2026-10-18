import type { EmailClass, ExtractedFields, Extraction, RawEmail, ShipmentStatus } from "@/lib/contracts";
import type { MatchInput } from "./matcher";

/**
 * Synthetic tracking-email sequences (#127): English and Traditional Chinese, merchant / carrier / convenience-store
 * senders, split shipments, package-only groups. Fictional stores on reserved .example domains, invented numbers.
 * `purchase` is the ground truth: emails with the same `purchase` belong to one purchase.
 */

export interface TrackingSpec {
  id: string;
  purchase: string;
  cls: EmailClass;
  from: string;
  subject: string;
  text: string;
  date: string;
  merchant?: string | null;
  domain?: string | null;
  ref?: string | null;
  total?: number;
  items?: Array<[name: string, qty: number, unitPrice: number]>;
  currency?: string;
  /** What the (fake) LLM returned for `fields.shipment`. */
  shipment?: { carrier?: string | null; trackingNumbers?: string[]; status?: ShipmentStatus | null; eta?: string | null; pickupLocation?: string | null };
  confMin?: number;
}

const BOWL = { merchant: "Bowl Keyboards", domain: null, from: '"Bowl Keyboards" <store@t.shopifyemail.com>' };
const TEA = { merchant: "Tea House Taipei", domain: "teahouse.example", from: '"Tea House Taipei" <orders@teahouse.example>' };

export const TRACKING_SPECS: TrackingSpec[] = [
  // Shopify store: confirmation -> shipped (tracking number) -> carrier out for delivery (only the number) -> delivered.
  { id: "bkb-confirmed", purchase: "bkb-9129", cls: "order", ...BOWL, ref: "BKB-9129", subject: "Order #BKB-9129 confirmed", date: "2026-09-22T15:00:00Z", total: 129, items: [["Bowl75 Keyboard Kit", 1, 129]], text: "Thanks for your order! Order #BKB-9129\nBowl75 Keyboard Kit x1 129\nOrder total: $129.00" },
  { id: "bkb-shipped", purchase: "bkb-9129", cls: "shipped", ...BOWL, subject: "A shipment from order #BKB-9129 is on the way", date: "2026-09-23T09:00:00Z", ref: null, text: "Your order #BKB-9129 is on the way.\nCarrier: UPS\nTracking number: 1Z999AA10123456784\nTrack your package", shipment: { carrier: "UPS", trackingNumbers: ["1Z999AA10123456784"], status: "shipped" } },
  { id: "bkb-out", purchase: "bkb-9129", cls: "shipped", merchant: null, domain: null, from: '"UPS" <pkginfo@ups.com>', subject: "UPS Update: Package Scheduled for Delivery Today", date: "2026-09-25T08:00:00Z", ref: null, text: "Your package is out for delivery today.\nTracking Number: 1Z999AA10123456784", shipment: { carrier: "UPS", trackingNumbers: ["1Z999AA10123456784"], status: "out_for_delivery" } },
  { id: "bkb-delivered", purchase: "bkb-9129", cls: "delivered", ...BOWL, subject: "A shipment from order #BKB-9129 has been delivered", date: "2026-09-25T14:00:00Z", ref: null, text: "Your package was delivered.\nTracking number: 1Z999AA10123456784", shipment: { trackingNumbers: ["1Z999AA10123456784"] } },

  // Same merchant, same week, another order: must stay a separate purchase.
  { id: "bkb2-confirmed", purchase: "bkb-9130", cls: "order", ...BOWL, ref: "BKB-9130", subject: "Order #BKB-9130 confirmed", date: "2026-09-24T10:00:00Z", total: 18, items: [["Switch Puller", 1, 18]], text: "Thanks for your order! Order #BKB-9130\nSwitch Puller x1 18\nOrder total: $18.00" },
  { id: "bkb2-shipped", purchase: "bkb-9130", cls: "shipped", ...BOWL, subject: "A shipment from order #BKB-9130 is on the way", date: "2026-09-24T18:00:00Z", ref: null, text: "Your order #BKB-9130 is on the way.\nTracking number: 9400111899223344556677", shipment: { carrier: "USPS", trackingNumbers: ["9400111899223344556677"] } },

  // Traditional Chinese, convenience-store pickup: shipped -> arrived at store -> picked up.
  { id: "tea-order", purchase: "tea-5521", cls: "order", ...TEA, ref: "TH-5521", subject: "訂單成立通知 TH-5521", date: "2026-10-01T04:00:00Z", total: 1280, currency: "TWD", items: [["阿里山烏龍茶", 2, 640]], text: "感謝您的訂購！\n訂單編號：TH-5521\n阿里山烏龍茶 x2 640\n訂單總計：NT$1,280" },
  { id: "tea-shipped", purchase: "tea-5521", cls: "shipped", ...TEA, ref: "TH-5521", subject: "您的訂單 TH-5521 已出貨", date: "2026-10-02T02:00:00Z", currency: "TWD", text: "您的訂單已出貨，物流單號：G12345678901\n配送方式：7-ELEVEN 超商取貨", shipment: { carrier: "7-ELEVEN", trackingNumbers: ["G12345678901"], status: "shipped" } },
  { id: "tea-store", purchase: "tea-5521", cls: "shipped", merchant: null, domain: null, from: '"7-ELEVEN 統一超商" <noreply@7-11.com.tw>', subject: "【7-ELEVEN】包裹已到店，請取貨", date: "2026-10-03T08:00:00Z", ref: null, currency: "TWD", text: "您的包裹已到店，可取貨。\n取貨編號：G12345678901\n取貨門市：信義門市\n請於 2026-10-10 前取貨", shipment: { carrier: "7-ELEVEN", trackingNumbers: ["G12345678901"], pickupLocation: "信義門市", eta: "2026-10-10" } },
  { id: "tea-picked", purchase: "tea-5521", cls: "delivered", merchant: null, domain: null, from: '"7-ELEVEN 統一超商" <noreply@7-11.com.tw>', subject: "【7-ELEVEN】您的包裹已取貨", date: "2026-10-04T10:30:00Z", ref: null, currency: "TWD", text: "您的包裹已取貨。\n取貨編號：G12345678901", shipment: { trackingNumbers: ["G12345678901"] } },

  // Split shipment: one order, two tracking numbers, items per package.
  { id: "split-order", purchase: "split-1", cls: "order", merchant: "Oakhaven Home", domain: "oakhaven.example", from: '"Oakhaven Home" <orders@oakhaven.example>', ref: "OK-300", subject: "Order #OK-300 confirmed", date: "2026-10-05T10:00:00Z", total: 70, items: [["Linen Throw", 1, 40], ["Candle Set", 1, 30]], text: "Order #OK-300\nLinen Throw x1 40\nCandle Set x1 30\nOrder total: $70.00" },
  { id: "split-ship-1", purchase: "split-1", cls: "shipped", merchant: "Oakhaven Home", domain: "oakhaven.example", from: '"Oakhaven Home" <orders@oakhaven.example>', ref: "OK-300", subject: "Part of order #OK-300 has shipped", date: "2026-10-06T10:00:00Z", items: [["Linen Throw", 1, 40]], text: "Linen Throw x1 has shipped.\nCarrier: FedEx\nTracking number: 794644790138", shipment: { carrier: "FedEx", trackingNumbers: ["794644790138"] } },
  { id: "split-ship-2", purchase: "split-1", cls: "shipped", merchant: "Oakhaven Home", domain: "oakhaven.example", from: '"Oakhaven Home" <orders@oakhaven.example>', ref: "OK-300", subject: "Part of order #OK-300 has shipped", date: "2026-10-08T10:00:00Z", items: [["Candle Set", 1, 30]], text: "Candle Set x1 has shipped.\nCarrier: DHL\nTracking number: 1234567890", shipment: { carrier: "DHL", trackingNumbers: ["1234567890"] } },

  // Package-only: tracking updates (carrier + marketplace) without any receipt.
  { id: "pkg-shipped", purchase: "pkg-1", cls: "shipped", merchant: "Lumen Beauty", domain: null, from: '"Lumen Beauty" <ship@lumen-beauty.example>', subject: "Your Lumen Beauty order has shipped", date: "2026-10-10T09:00:00Z", ref: null, text: "Your order has shipped.\nCarrier: FedEx\nTracking number: 612345678901\nEstimated delivery: 2026-10-14", shipment: { carrier: "FedEx", trackingNumbers: ["612345678901"], eta: "2026-10-14" } },
  { id: "pkg-out", purchase: "pkg-1", cls: "shipped", merchant: "FedEx", domain: null, from: '"FedEx" <TrackingUpdates@fedex.com>', subject: "Your package is out for delivery", date: "2026-10-14T08:00:00Z", ref: null, text: "Your package is out for delivery today. Tracking number: 612345678901", shipment: { carrier: "FedEx", trackingNumbers: ["612345678901"] } },
  { id: "pkg-delivered", purchase: "pkg-1", cls: "delivered", merchant: "FedEx", domain: null, from: '"FedEx" <TrackingUpdates@fedex.com>', subject: "Delivered: your package", date: "2026-10-14T15:00:00Z", ref: null, text: "Your package was delivered. Tracking number: 612345678901", shipment: { trackingNumbers: ["612345678901"] } },
  // The receipt of the package-only group arrives later (a later sync): it carries the same tracking number.
  { id: "pkg-receipt", purchase: "pkg-1", cls: "order", merchant: "Lumen Beauty", domain: "lumen-beauty.example", from: '"Lumen Beauty" <orders@lumen-beauty.example>', ref: "LB-7001", subject: "Order #LB-7001 confirmed", date: "2026-10-09T10:00:00Z", total: 46, items: [["Glow Serum", 1, 46]], text: "Order #LB-7001\nGlow Serum x1 46\nOrder total: $46.00\nTracking number: 612345678901" },

  // Package-only, Shopee marketplace, no number in the first email beyond the label.
  { id: "shopee-1", purchase: "shopee-1", cls: "shipped", merchant: "蝦皮購物", domain: null, from: '"蝦皮購物" <noreply@shopee.tw>', subject: "【蝦皮購物】您的訂單已出貨", date: "2026-10-12T03:00:00Z", ref: null, currency: "TWD", text: "您的商品已出貨。\n物流商：黑貓宅急便\n追蹤編號：123456789012", shipment: { carrier: "黑貓宅急便", trackingNumbers: ["123456789012"] } },
  { id: "shopee-2", purchase: "shopee-1", cls: "shipped", merchant: null, domain: null, from: '"黑貓宅急便" <service@t-cat.com.tw>', subject: "黑貓宅急便 配送中", date: "2026-10-13T01:00:00Z", ref: null, currency: "TWD", text: "您的包裹配送中。\n查貨號碼：123456789012" },
];

export function rawEmailOfTracking(spec: TrackingSpec): RawEmail {
  return { id: spec.id, from: spec.from, subject: spec.subject, date: spec.date, text: spec.text };
}

export function extractionOfTracking(spec: TrackingSpec): Extraction {
  const fields: ExtractedFields = {
    merchant: spec.merchant === undefined ? null : spec.merchant,
    merchantDomain: spec.domain ?? null,
    orderRef: spec.ref ?? null,
    date: spec.date.slice(0, 10),
    currency: spec.currency ?? "USD",
    lineItems: (spec.items ?? []).map(([name, qty, unitPrice]) => ({ name, qty, unitPrice })),
    totals: spec.total !== undefined ? { total: spec.total } : {},
    ...(spec.shipment ? { shipment: { trackingNumbers: [], ...spec.shipment } } : {}),
  };
  return { emailId: spec.id, class: spec.cls, fields, confidence: {}, evidence: {}, confMin: spec.confMin ?? 0.95, model: "tracking-fixture", cached: false };
}

export function matchInputOfTracking(spec: TrackingSpec): MatchInput {
  return { email: rawEmailOfTracking(spec), extraction: extractionOfTracking(spec) };
}

export const trackingSpec = (id: string): TrackingSpec => {
  const found = TRACKING_SPECS.find((spec) => spec.id === id);
  if (!found) throw new Error(`unknown tracking spec ${id}`);
  return found;
};

export const trackingInputs = (...ids: string[]): MatchInput[] => ids.map((id) => matchInputOfTracking(trackingSpec(id)));
