// Oakhaven Home: fictional furniture store; large orders ship in split shipments.
import type { StoreTemplate } from "./types";

export const oakhaven: StoreTemplate = {
  key: "oakhaven",
  name: "Oakhaven Home",
  domain: "oakhaven.example",
  category: "furniture",
  senders: {
    orders: "orders@oakhaven.example",
    shipping: "delivery@oakhaven.example",
    returns: "returns@oakhaven.example",
    refunds: "accounts@oakhaven.example",
    marketing: "studio@oakhaven.example",
  },
  supportPhone: "(866) 555-0163",
  hqAddress: "800 Example Timber Road, Grand Rapids, MI 49000",
  carrier: "White Glove Freight",
  policy: { returnWindowDays: 30, windowAnchor: "delivery", refundSlaDays: 10 },
  subject: (kind, ref) => {
    switch (kind) {
      case "order":
        return `Oakhaven Home order ${ref} received`;
      case "shipped":
        return `Oakhaven Home: your order ${ref} has shipped`;
      case "delivered":
        return `Oakhaven Home delivery complete for ${ref}`;
      case "return_received":
        return `Oakhaven Home return received (${ref})`;
      case "refund":
        return `Oakhaven Home refund for order ${ref}`;
      default:
        return `Oakhaven Home order ${ref}`;
    }
  },
  intro: {
    order: "Thank you for choosing Oakhaven Home. Large items may arrive in separate shipments.",
    shipped: "Your furniture is on its way. Our freight partner will call to schedule delivery.",
  },
};
