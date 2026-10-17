// Brewbox Coffee: fictional direct-to-consumer coffee subscription with monthly renewals.
import { CUSTOMER } from "./render";
import type { RenderedEmail, StoreTemplate } from "./types";

export const brewbox: StoreTemplate = {
  key: "brewbox",
  name: "Brewbox Coffee",
  domain: "brewbox.example",
  category: "dtc_subscription",
  senders: {
    orders: "subscriptions@brewbox.example",
    shipping: "roastery@brewbox.example",
    returns: "help@brewbox.example",
    refunds: "help@brewbox.example",
    marketing: "news@brewbox.example",
  },
  supportPhone: "(855) 555-0195",
  hqAddress: "9 Example Roast Alley, Denver, CO 80000",
  carrier: "ParcelPost Ground",
  policy: { finalSaleText: "Subscription coffee shipments are final sale." },
  subject: (kind, ref) => {
    switch (kind) {
      case "order":
        return `Your Brewbox subscription renewed: order ${ref}`;
      case "shipped":
        return `Freshly roasted and shipped: Brewbox order ${ref}`;
      default:
        return `Brewbox order ${ref}`;
    }
  },
  intro: {
    order: "Your monthly Brewbox subscription renewed. We roast on Monday and ship within 2 days.",
    shipped: "Your beans were roasted this week and are on the way.",
  },
};

export function brewboxPriceNotice(): RenderedEmail {
  return {
    from: `"Brewbox Coffee" <${brewbox.senders.marketing}>`,
    subject: "A note about your Brewbox plan price",
    text: [
      "Brewbox Coffee",
      `Hi ${CUSTOMER.firstName},`,
      "Starting with your November 3, 2026 renewal, your Single Origin plan will be $20.00 per shipment (currently $18.00 before your subscriber discount).",
      "You can pause or cancel any time from your account page. No action is needed to keep your plan.",
      "This is an account notice, not a receipt.",
    ].join("\n\n"),
  };
}
