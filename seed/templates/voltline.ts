// Voltline Electronics: fictional electronics store (also sells in CAD for the multi-currency case).
import type { StoreTemplate } from "./types";

export const voltline: StoreTemplate = {
  key: "voltline",
  name: "Voltline Electronics",
  domain: "voltline.example",
  category: "electronics",
  senders: {
    orders: "orders@voltline.example",
    shipping: "ship-notify@voltline.example",
    returns: "returns@voltline.example",
    refunds: "billing@voltline.example",
    marketing: "deals@voltline.example",
  },
  supportPhone: "(888) 555-0127",
  hqAddress: "2400 Circuit Example Blvd, San Jose, CA 95000",
  carrier: "SwiftShip Express",
  policy: { returnWindowDays: 30, windowAnchor: "delivery", priceAdjustDays: 14 },
  subject: (kind, ref) => {
    switch (kind) {
      case "order":
        return `Voltline order confirmation #${ref}`;
      case "shipped":
        return `Shipped: Voltline order #${ref}`;
      case "delivered":
        return `Your Voltline order #${ref} was delivered`;
      case "return_started":
        return `Return label for Voltline order #${ref}`;
      case "return_received":
        return `Return received: Voltline order #${ref}`;
      default:
        return `Voltline order #${ref} update`;
    }
  },
  intro: { order: "Thanks for shopping at Voltline. Your order is being prepared." },
};
