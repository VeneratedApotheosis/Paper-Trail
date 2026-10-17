// Lumen Beauty: fictional beauty store with a points program.
import { CUSTOMER } from "./render";
import type { RenderedEmail, StoreTemplate } from "./types";

export const lumenBeauty: StoreTemplate = {
  key: "lumen",
  name: "Lumen Beauty",
  domain: "lumenbeauty.example",
  category: "beauty",
  senders: {
    orders: "hello@lumenbeauty.example",
    shipping: "hello@lumenbeauty.example",
    returns: "care@lumenbeauty.example",
    refunds: "care@lumenbeauty.example",
    marketing: "glow@lumenbeauty.example",
  },
  supportPhone: "(877) 555-0156",
  hqAddress: "55 Example Petal Street, Brooklyn, NY 11000",
  carrier: "ParcelPost Ground",
  policy: { returnWindowDays: 60, windowAnchor: "purchase", refundSlaDays: 14 },
  subject: (kind, ref) => {
    switch (kind) {
      case "order":
        return `Lumen Beauty order ${ref}: thanks, gorgeous!`;
      case "shipped":
        return `Your Lumen Beauty order ${ref} shipped`;
      case "return_started":
        return `Lumen Beauty return started (${ref})`;
      case "return_received":
        return `Lumen Beauty: we got your return (${ref})`;
      case "refund":
        return `Lumen Beauty refund processed (${ref})`;
      default:
        return `Lumen Beauty order ${ref}`;
    }
  },
  intro: { order: "Your glow-up is on the way. You earned Glow Points on this order." },
};

export function lumenPointsNotice(): RenderedEmail {
  return {
    from: `"Lumen Beauty" <${lumenBeauty.senders.marketing}>`,
    subject: "Your Glow Points balance: 1,240 points",
    text: [
      "Lumen Beauty Glow Points",
      `Hi ${CUSTOMER.firstName},`,
      "Your Glow Points balance is 1,240 points.\n300 points expire on November 30, 2026.",
      "Redeem 500 points for $10 off your next order at checkout.",
      "This is an account notice, not a receipt.",
    ].join("\n\n"),
  };
}
