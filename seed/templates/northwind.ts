// Northwind Outfitters: fictional apparel store. Also home of the phishing lookalike and a price-drop promo.
import { CUSTOMER } from "./render";
import type { RenderedEmail, StoreTemplate } from "./types";

export const northwind: StoreTemplate = {
  key: "northwind",
  name: "Northwind Outfitters",
  domain: "northwind.example",
  category: "apparel",
  senders: {
    orders: "orders@northwind.example",
    shipping: "shipping@northwind.example",
    returns: "returns@northwind.example",
    refunds: "refunds@northwind.example",
    marketing: "news@northwind.example",
  },
  supportPhone: "(800) 555-0110",
  hqAddress: "100 Harbor Example Way, Portland, OR 97000",
  carrier: "ParcelPost Ground",
  policy: { returnWindowDays: 30, windowAnchor: "delivery", refundSlaDays: 7, priceAdjustDays: 14 },
  subject: (kind, ref) => {
    switch (kind) {
      case "order":
        return `Your Northwind order ${ref} is confirmed`;
      case "shipped":
        return `Your Northwind order ${ref} has shipped`;
      case "delivered":
        return `Delivered: Northwind order ${ref}`;
      case "return_started":
        return `Your return for ${ref} has started`;
      case "return_received":
        return `We received your return for ${ref}`;
      default:
        return `Northwind Outfitters: update on order ${ref}`;
    }
  },
};

export function northwindPromo(): RenderedEmail {
  return {
    from: `"Northwind Outfitters" <${northwind.senders.marketing}>`,
    subject: "Fall markdowns are here: up to 21% off outerwear",
    text: [
      "Northwind Outfitters",
      "Fall markdowns",
      `Hi ${CUSTOMER.firstName},`,
      "Our fall markdowns just dropped. Prices below are valid while supplies last.",
      [
        "  Ridgeline Down Jacket (SKU NW-JKT-RDG): now $149.00 (was $189.00)",
        "  Merino Beanie (SKU NW-BNE-MER): now $22.00 (was $28.00)",
        "  Canvas Chore Jacket (SKU NW-JKT-CHR): $98.00",
      ].join("\n"),
      "Bought one recently? Price adjustments within 14 days of purchase. Reply with your order number.",
      "Shop the sale: https://northwind.example/fall-markdowns",
      "You are receiving this because you subscribed to Northwind news. Unsubscribe: https://northwind.example/unsubscribe",
    ].join("\n\n"),
  };
}

/** Lookalike domain (zero instead of "o"). Must never become an order or refund. */
export function northwindPhishing(): RenderedEmail {
  return {
    from: '"Northwind Support" <security@n0rthwind-support.example>',
    subject: "Action required: verify your card to release your Northwind refund",
    text: [
      "Dear valued customer,",
      "We were unable to process the refund for your recent Northwind Outfitters order because your payment details could not be verified.",
      "To release your refund within 24 hours, verify your card now:\nhttp://n0rthwind-support.example/verify-card",
      "You will be asked to confirm your full card number, expiration date and security code.",
      "If you do not verify within 24 hours your refund will be cancelled.",
      "Northwind Security Team",
    ].join("\n\n"),
  };
}
