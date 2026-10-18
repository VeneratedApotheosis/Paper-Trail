import { describe, expect, it } from "vitest";
import type { RawEmail } from "@/lib/contracts";
import { classify } from "./classify";

// Real-inbox miss: point-of-sale receipts priced as "NT$199" (and other prefixed / Asian currencies) were classified
// not_receipt because the total and item-price checks only knew "$199", "€", "£" and a few ISO codes.
// Synthetic receipt modeled on a Shopline POS email; no real data.
function posReceipt(total: string, item = `Woven Belt | 1 | ${total} TX`): RawEmail {
  return {
    id: "pos-currency",
    from: '"Sample Boutique" <sender@shopline.com>',
    subject: "[Sample Boutique] Thank you for your purchase #1234567890123456789!",
    date: "2026-08-31T10:21:43Z",
    text: [
      "[Sample Boutique] Transaction Details #1234567890123456789!",
      "Order Date",
      "2026-08-31 18:21PM GMT+08:00",
      "Order No.",
      "20260831102129904",
      "Store",
      "Sample Boutique Downtown",
      "Product | Quantity | Price | Subtotal",
      item,
      "1 checkout item(s) in total",
      `Subtotal: | ${total}`,
      `Total: ${total}`,
      "Sample Boutique",
    ].join("\n"),
  };
}

describe("classify: prefixed and Asian currencies count as purchase evidence", () => {
  for (const total of ["NT$199", "HK$88.50", "A$45.00", "C$12.99", "S$30", "US$19.99", "R$59,90", "¥1,280", "₩15,000", "₹499", "TWD 199", "199 元"]) {
    it(`classifies a platform-sent POS receipt totalling ${total.replace("$", "＄")} as an order`, () => {
      expect(classify(posReceipt(total)).class).toBe("order");
    });
  }

  it("still flags a shop name on an unrelated non-platform domain as suspicious", () => {
    const spoof = { ...posReceipt("NT$199"), from: '"Sample Boutique" <billing@random-mailer.example>' };
    expect(classify(spoof).class).not.toBe("order");
  });

  it("still treats an amount-free thank-you note as not a receipt", () => {
    const note = posReceipt("NT$199");
    note.subject = "News from Sample Boutique";
    note.text = "New arrivals are in store this week. We hope to see you again soon.";
    expect(classify(note).class).not.toBe("order");
  });
});
