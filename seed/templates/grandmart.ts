// Grandmart: fictional big-box store. Includes a forwarded in-store receipt.
import { CUSTOMER, CUSTOMER_TO, orderConfirmationBody } from "./render";
import type { RenderedEmail, SeedOrder, SeedOrderEmail, StoreTemplate } from "./types";

export const grandmart: StoreTemplate = {
  key: "grandmart",
  name: "Grandmart",
  domain: "grandmart.example",
  category: "big_box",
  senders: {
    orders: "receipts@grandmart.example",
    shipping: "delivery@grandmart.example",
    returns: "returns@grandmart.example",
    refunds: "refunds@grandmart.example",
    marketing: "weekly-ad@grandmart.example",
  },
  supportPhone: "(800) 555-0134",
  hqAddress: "1 Grandmart Example Plaza, Columbus, OH 43000",
  carrier: "Grandmart Delivery",
  policy: { returnWindowDays: 90, windowAnchor: "purchase", refundSlaDays: 5, priceAdjustDays: 14 },
  subject: (kind, ref) => {
    switch (kind) {
      case "order":
        return `Your Grandmart receipt ${ref}`;
      case "shipped":
        return `Grandmart order ${ref} is out for delivery`;
      case "delivered":
        return `Grandmart order ${ref} delivered`;
      case "return_dropped":
        return `Return dropped off: Grandmart order ${ref}`;
      case "return_received":
        return `Grandmart return received for ${ref}`;
      case "refund":
        return `Grandmart refund for ${ref}`;
      case "cancel":
        return `Grandmart order ${ref} cancelled`;
      default:
        return `Grandmart order ${ref}`;
    }
  },
  intro: { order: "Thanks for shopping Grandmart. Here is your receipt." },
};

export const SAM_WORK_ADDRESS = "s.rivera@work.example";

/** Sam forwards a receipt from a work inbox to the personal inbox; the receipt prints the full (test) card number set on the email. */
export function forwardedGrandmartReceipt(order: SeedOrder, email: SeedOrderEmail): RenderedEmail {
  const inner = orderConfirmationBody(order, { ...email, kind: "order", render: undefined });
  return {
    from: `"${CUSTOMER.name}" <${SAM_WORK_ADDRESS}>`,
    to: CUSTOMER_TO,
    subject: `Fwd: Your Grandmart receipt ${order.orderRef}`,
    text: [
      "Forwarding this to my personal inbox for our records. -S",
      [
        "---------- Forwarded message ---------",
        `From: Grandmart Receipts <${grandmart.senders.orders}>`,
        "Date: Thu, Aug 20, 2026 at 1:00 PM",
        `Subject: Your Grandmart receipt ${order.orderRef}`,
        `To: <${SAM_WORK_ADDRESS}>`,
      ].join("\n"),
      inner,
    ].join("\n\n"),
  };
}
