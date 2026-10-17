// Bazaarly: fictional multi-seller marketplace. Includes a Spanish-language receipt and a deals newsletter.
import { CUSTOMER, longDateEs, money, subtotalOf, totalOf, orderSnapshot } from "./render";
import type { RenderedEmail, SeedOrder, StoreTemplate } from "./types";

export const bazaarly: StoreTemplate = {
  key: "bazaarly",
  name: "Bazaarly",
  domain: "bazaarly.example",
  category: "marketplace",
  senders: {
    orders: "order-update@bazaarly.example",
    shipping: "shipment-tracking@bazaarly.example",
    returns: "returns@bazaarly.example",
    refunds: "payments@bazaarly.example",
    marketing: "deals@bazaarly.example",
  },
  supportPhone: "(800) 555-0171",
  hqAddress: "410 Example Market Street, Seattle, WA 98000",
  carrier: "Bazaarly Return Point",
  policy: { returnWindowDays: 30, windowAnchor: "delivery" },
  subject: (kind, ref) => {
    switch (kind) {
      case "order":
        return `Your Bazaarly order #${ref}`;
      case "order_resent":
        return `[Resent] Your Bazaarly order #${ref}`;
      case "order_updated":
        return `Updated: your Bazaarly order #${ref}`;
      case "delivered":
        return `Delivered: your Bazaarly package for #${ref}`;
      case "return_dropped":
        return `Your Bazaarly return for #${ref} was dropped off`;
      case "return_received":
        return `Bazaarly received your return for #${ref}`;
      case "store_credit":
        return `Your Bazaarly Gift Balance was credited (#${ref})`;
      default:
        return `Bazaarly order #${ref}`;
    }
  },
  intro: {
    order: "Thanks for shopping on Bazaarly. Items from different sellers may arrive separately.",
    order_updated: "You changed the quantity of an item in your order. This summary replaces your earlier confirmation.",
  },
  storeCreditName: "Bazaarly Gift Balance",
};

/** Spanish-language order confirmation; prints a full (test) card number for redaction tests. */
export function bazaarlySpanishReceipt(order: SeedOrder): RenderedEmail {
  const { currency } = order;
  const snapshot = orderSnapshot(order);
  const items = order.items
    .map(
      (item) =>
        `  ${item.name} (SKU ${item.sku})\n    Cant. ${item.qty} @ ${money(item.unitPrice, currency)} = ${money(item.qty * item.unitPrice, currency)}` +
        (item.soldBy ? `\n    Vendido por: ${item.soldBy}` : ""),
    )
    .join("\n");
  return {
    from: `"Bazaarly" <${bazaarly.senders.orders}>`,
    subject: `Confirmación de tu pedido Bazaarly #${order.orderRef}`,
    text: [
      "Bazaarly\nConfirmación de pedido",
      `Hola ${CUSTOMER.firstName}:\n\nGracias por tu compra. Te avisaremos cuando tu pedido sea enviado.`,
      `Número de pedido: ${order.orderRef}\nFecha del pedido: ${longDateEs(order.placedAt)}\nMétodo de pago: ${order.cardBrand} 4242 4242 4242 4242`,
      `Artículos\n${items}`,
      [
        `Subtotal: ${money(subtotalOf(order.items), currency)}`,
        `Envío: ${money(snapshot.shipping, currency)}`,
        `Impuestos: ${money(snapshot.tax, currency)}`,
        `Total del pedido: ${money(totalOf(snapshot), currency)} ${currency}`,
      ].join("\n"),
      `Dirección de envío:\n${CUSTOMER.name}\n${CUSTOMER.street}\n${CUSTOMER.cityLine}\nTeléfono: ${CUSTOMER.phone}`,
      "Políticas\nSe aceptan devoluciones dentro de los 30 días posteriores a la entrega.",
      `¿Preguntas? Llama al ${bazaarly.supportPhone}.\nBazaarly, ${bazaarly.hqAddress}`,
    ].join("\n\n"),
  };
}

export function bazaarlyDeals(): RenderedEmail {
  return {
    from: `"Bazaarly Deals" <${bazaarly.senders.marketing}>`,
    subject: "Today's deals picked for you, Sam",
    text: [
      "Bazaarly Daily Deals",
      `Hi ${CUSTOMER.firstName}, here are today's picks based on your browsing:`,
      [
        "  Cast Iron Skillet 12in: $29.99 (was $44.99)",
        "  Wireless Earbuds Pro: $59.00 (was $89.00)",
        "  Linen Throw Pillow Covers, set of 2: $18.49",
      ].join("\n"),
      "Deals end at midnight. Prices and availability are set by each seller.",
      "Shop now: https://bazaarly.example/deals\nUnsubscribe: https://bazaarly.example/unsubscribe",
    ].join("\n\n"),
  };
}
