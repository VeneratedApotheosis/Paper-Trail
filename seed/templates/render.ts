// Generic plain-text renderers shared by all store templates. All names, addresses, phones and cards are fake.
import type {
  OrderSnapshot,
  RenderedEmail,
  SeedItemRef,
  SeedLineItem,
  SeedOrder,
  SeedOrderEmail,
  StorePolicy,
} from "./types";

export const CUSTOMER = {
  name: "Sam Rivera",
  firstName: "Sam",
  email: "sam.rivera@mail.example",
  phone: "(415) 555-0142",
  street: "742 Larkspur Avenue, Apt 5",
  cityLine: "Fairview, CA 95999",
} as const;

export const CUSTOMER_TO = `${CUSTOMER.name} <${CUSTOMER.email}>`;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const DAY_MS = 24 * 60 * 60 * 1000;

export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** "August 28, 2026" (UTC). */
export function longDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** "28 de septiembre de 2026" (UTC). */
export function longDateEs(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} de ${MONTHS_ES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/** "2026-08-28" (UTC). */
export function isoDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function money(value: number, currency: string): string {
  const fixed = Math.abs(value).toFixed(2);
  const [whole, cents] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = value < 0 ? "-" : "";
  if (currency === "USD") return `${sign}$${grouped}.${cents}`;
  if (currency === "CAD") return `${sign}CA$${grouped}.${cents}`;
  return `${sign}${grouped}.${cents} ${currency}`;
}

export function subtotalOf(items: SeedLineItem[]): number {
  return roundCents(items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0));
}

export function totalOf(snapshot: OrderSnapshot): number {
  return roundCents(subtotalOf(snapshot.items) - snapshot.discount + snapshot.shipping + snapshot.tax);
}

export function orderSnapshot(order: SeedOrder): OrderSnapshot {
  return { items: order.items, tax: order.tax, shipping: order.shipping, discount: order.discount };
}

export function effectivePolicy(order: SeedOrder): StorePolicy {
  return order.policy ?? order.store.policy;
}

export function findItem(order: SeedOrder, sku: string): SeedLineItem {
  const item = order.items.find((candidate) => candidate.sku === sku);
  if (!item) throw new Error(`Unknown sku ${sku} on ${order.orderRef}`);
  return item;
}

/** Line items an email refers to: its item subset, else the whole order. */
export function itemsFor(order: SeedOrder, refs: SeedItemRef[] | undefined): SeedLineItem[] {
  if (!refs) return order.items;
  return refs.map((ref) => ({ ...findItem(order, ref.sku), qty: ref.qty }));
}

export function priceLines(items: SeedLineItem[], currency: string): string {
  return items
    .map((item) => {
      const seller = item.soldBy ? `\n    Sold by: ${item.soldBy}` : "";
      return (
        `  ${item.name} (SKU ${item.sku})\n` +
        `    Qty ${item.qty} @ ${money(item.unitPrice, currency)} = ${money(item.qty * item.unitPrice, currency)}` +
        seller
      );
    })
    .join("\n");
}

export function qtyLines(items: SeedLineItem[]): string {
  return items.map((item) => `  ${item.name} (SKU ${item.sku}) x${item.qty}`).join("\n");
}

export function totalsBlock(snapshot: OrderSnapshot, currency: string, taxLabel = "Tax"): string {
  const lines = [`Subtotal: ${money(subtotalOf(snapshot.items), currency)}`];
  if (snapshot.discount > 0) lines.push(`Discount: ${money(-snapshot.discount, currency)}`);
  lines.push(`Shipping: ${money(snapshot.shipping, currency)}`);
  lines.push(`${taxLabel}: ${money(snapshot.tax, currency)}`);
  lines.push(`Order total: ${money(totalOf(snapshot), currency)}`);
  return lines.join("\n");
}

export function shipToBlock(): string {
  return [
    "Shipping to:",
    CUSTOMER.name,
    CUSTOMER.street,
    CUSTOMER.cityLine,
    `Phone: ${CUSTOMER.phone}`,
  ].join("\n");
}

export function returnPolicySentence(policy: StorePolicy): string | null {
  if (policy.finalSaleText) return policy.finalSaleText;
  if (!policy.returnWindowDays) return null;
  const anchor = policy.windowAnchor === "delivery" ? "delivery" : "purchase";
  return `Returns accepted within ${policy.returnWindowDays} days of ${anchor}.`;
}

export function refundSlaSentence(policy: StorePolicy): string | null {
  if (policy.finalSaleText || !policy.refundSlaDays) return null;
  return `Refunds are issued within ${policy.refundSlaDays} days of receiving your return.`;
}

export function priceAdjustSentence(policy: StorePolicy): string | null {
  if (policy.finalSaleText || !policy.priceAdjustDays) return null;
  return `Price adjustments within ${policy.priceAdjustDays} days of purchase.`;
}

export function policyBlock(policy: StorePolicy): string {
  const lines = [returnPolicySentence(policy), refundSlaSentence(policy), priceAdjustSentence(policy)].filter(
    (line): line is string => line !== null,
  );
  return lines.length > 0 ? `Our policies\n${lines.join("\n")}` : "";
}

function footer(order: SeedOrder): string {
  const { store } = order;
  return `Questions? Call ${store.supportPhone} or reply to this email.\n${store.name}, ${store.hqAddress}`;
}

function paymentLine(order: SeedOrder, email: SeedOrderEmail): string {
  if (email.fullCardNumber) return `Payment: ${order.cardBrand} ${email.fullCardNumber} (approved)`;
  return `Payment: ${order.cardBrand} ending in ${order.last4}`;
}

function senderFor(order: SeedOrder, email: SeedOrderEmail): string {
  const { senders, name } = order.store;
  const address = (() => {
    switch (email.kind) {
      case "shipped":
      case "delivered":
        return senders.shipping;
      case "return_started":
      case "return_dropped":
      case "return_received":
        return senders.returns;
      case "refund":
      case "store_credit":
        return senders.refunds;
      default:
        return senders.orders;
    }
  })();
  return `"${name}" <${address}>`;
}

function join(...sections: Array<string | null | undefined | false>): string {
  return sections.filter((section): section is string => Boolean(section)).join("\n\n");
}

/** Body of an order confirmation (also reused by forwarded wrappers). */
export function orderConfirmationBody(order: SeedOrder, email: SeedOrderEmail): string {
  const snapshot = email.snapshot ?? orderSnapshot(order);
  const { store, currency } = order;
  const intro = store.intro?.order ?? "Thanks for your order! We'll email you when it ships.";
  return join(
    `${store.name}\nOrder confirmation`,
    `Hi ${CUSTOMER.firstName},\n\n${intro}`,
    email.note,
    `Order number: ${order.orderRef}\nOrder date: ${longDate(order.placedAt)}\n${paymentLine(order, email)}`,
    `Items\n${priceLines(snapshot.items, currency)}`,
    totalsBlock(snapshot, currency),
    shipToBlock(),
    policyBlock(effectivePolicy(order)),
    footer(order),
  );
}

function orderBody(order: SeedOrder, email: SeedOrderEmail): string {
  const { store, currency } = order;
  const policy = effectivePolicy(order);
  switch (email.kind) {
    case "order":
      return orderConfirmationBody(order, email);
    case "order_resent":
      return join(
        `This is a copy of your order confirmation for ${order.orderRef}, resent at your request. Nothing has changed.`,
        orderConfirmationBody(order, email),
      );
    case "order_updated":
      return join(
        `${store.name}\nOrder updated`,
        `Hi ${CUSTOMER.firstName},\n\n${store.intro?.order_updated ?? "Your order has been updated. This summary replaces your earlier confirmation."}`,
        `Order number: ${order.orderRef}\nOrder date: ${longDate(order.placedAt)}\nUpdated on: ${longDate(email.at)}\n${paymentLine(order, email)}`,
        `Updated items\n${priceLines(order.items, currency)}`,
        totalsBlock(orderSnapshot(order), currency),
        shipToBlock(),
        policyBlock(policy),
        footer(order),
      );
    case "shipped": {
      const shipment = email.shipment ? ` (shipment ${email.shipment.index} of ${email.shipment.count})` : "";
      const remaining =
        email.shipment && email.shipment.index < email.shipment.count
          ? "The rest of your order will ship separately. We'll email you again when it does."
          : null;
      return join(
        `${store.name}\nShipping update`,
        `Hi ${CUSTOMER.firstName},\n\n${store.intro?.shipped ?? "Good news: your order is on its way."}`,
        `Order number: ${order.orderRef}${shipment}\nShipped on: ${longDate(email.at)}\nCarrier: ${store.carrier}\nTracking number: ${trackingNumber(email.id)}`,
        `In this shipment\n${qtyLines(itemsFor(order, email.items))}`,
        remaining,
        shipToBlock(),
        footer(order),
      );
    }
    case "delivered": {
      const shipment = email.shipment ? ` (shipment ${email.shipment.index} of ${email.shipment.count})` : "";
      return join(
        `${store.name}\nDelivered`,
        `Hi ${CUSTOMER.firstName},\n\nYour package was delivered on ${longDate(email.at)}.`,
        `Order number: ${order.orderRef}${shipment}\nCarrier: ${store.carrier}`,
        `Delivered items\n${qtyLines(itemsFor(order, email.items))}`,
        returnPolicySentence(policy),
        footer(order),
      );
    }
    case "return_started":
      return join(
        `${store.name}\nReturn started`,
        `Hi ${CUSTOMER.firstName},\n\nWe've created a return for order ${order.orderRef} on ${longDate(email.at)}. Print the attached label and drop the package at any ${store.carrier} location.`,
        `Items being returned\n${priceLines(itemsFor(order, email.items), currency)}`,
        refundSlaSentence(policy),
        footer(order),
      );
    case "return_dropped":
      return join(
        `${store.name}\nReturn dropped off`,
        `Hi ${CUSTOMER.firstName},\n\nYour return for order ${order.orderRef} was dropped off at a ${store.carrier} location on ${longDate(email.at)}. It is on its way to our returns center.`,
        `Items in this return\n${priceLines(itemsFor(order, email.items), currency)}`,
        refundSlaSentence(policy),
        footer(order),
      );
    case "return_received":
      return join(
        `${store.name}\nReturn received`,
        `Hi ${CUSTOMER.firstName},\n\nWe received your return for order ${order.orderRef} on ${longDate(email.at)}.`,
        `Items received\n${priceLines(itemsFor(order, email.items), currency)}`,
        refundSlaSentence(policy),
        footer(order),
      );
    case "refund":
      return join(
        `${store.name}\nRefund issued`,
        `Hi ${CUSTOMER.firstName},\n\nWe issued a refund of ${money(requireAmount(email), currency)} for order ${order.orderRef} on ${longDate(email.at)}.`,
        email.note,
        `Refund amount: ${money(requireAmount(email), currency)}\nRefunded to: ${order.cardBrand} ending in ${order.last4}\nPlease allow 3-5 days for it to appear on your statement.`,
        footer(order),
      );
    case "store_credit": {
      const creditName = store.storeCreditName ?? `${store.name} store credit`;
      return join(
        `${store.name}\nStore credit issued`,
        `Hi ${CUSTOMER.firstName},\n\nYour return for order ${order.orderRef} was processed on ${longDate(email.at)}. We added ${money(requireAmount(email), currency)} to your ${creditName}.`,
        `Store credit amount: ${money(requireAmount(email), currency)}\nThis amount was issued as store credit, not refunded to your ${order.cardBrand} ending in ${order.last4}.`,
        footer(order),
      );
    }
    case "cancel":
      return join(
        `${store.name}\nOrder cancelled`,
        `Hi ${CUSTOMER.firstName},\n\n${store.intro?.cancel ?? "We're sorry: an item in your order went out of stock before it shipped, so we cancelled the order."}`,
        `Order number: ${order.orderRef}\nCancelled on: ${longDate(email.at)}`,
        `Cancelled items\n${priceLines(order.items, currency)}`,
        `Your ${order.cardBrand} ending in ${order.last4} was not charged. Any pending authorization will drop off within a few days.`,
        footer(order),
      );
  }
}

function requireAmount(email: SeedOrderEmail): number {
  if (email.amount === undefined) throw new Error(`Email ${email.id} needs an amount`);
  return email.amount;
}

/** Deterministic fake tracking number derived from the email id. */
function trackingNumber(emailId: string): string {
  let hash = 7;
  for (const char of emailId) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000_007;
  return `PT${String(hash).padStart(10, "0")}`;
}

export function renderOrderEmail(order: SeedOrder, email: SeedOrderEmail): RenderedEmail {
  if (email.render) return email.render(order, email);
  return {
    from: senderFor(order, email),
    subject: order.store.subject(email.kind, order.orderRef),
    text: orderBody(order, email),
  };
}
