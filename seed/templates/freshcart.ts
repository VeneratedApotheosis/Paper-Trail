// FreshCart Grocery: fictional grocery delivery. Perishables are final sale, so no return-deadline alerts.
import type { StoreTemplate } from "./types";

export const freshcart: StoreTemplate = {
  key: "freshcart",
  name: "FreshCart Grocery",
  domain: "freshcart.example",
  category: "grocery",
  senders: {
    orders: "receipts@freshcart.example",
    shipping: "receipts@freshcart.example",
    returns: "help@freshcart.example",
    refunds: "help@freshcart.example",
    marketing: "offers@freshcart.example",
  },
  supportPhone: "(844) 555-0188",
  hqAddress: "22 Example Orchard Lane, Sacramento, CA 95000",
  carrier: "FreshCart Courier",
  policy: { finalSaleText: "Perishable grocery items are final sale and cannot be returned." },
  subject: (kind, ref) => {
    switch (kind) {
      case "order":
        return `Your FreshCart receipt for order ${ref}`;
      case "refund":
        return `FreshCart refund for a missing item (${ref})`;
      default:
        return `FreshCart order ${ref}`;
    }
  },
  intro: {
    order: "Your groceries were delivered today. Here is your receipt.",
  },
};
