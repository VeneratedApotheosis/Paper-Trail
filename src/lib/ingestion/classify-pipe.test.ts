import { describe, expect, it } from "vitest";
import type { RawEmail } from "@/lib/contracts";
import { classify } from "./classify";

// #116: table-aware HTML-to-text emits "Label | value" rows. In a promo-heavy confirmation, the total line is what proves
// a real purchase (orderEvidence), so "Order total | $x" must count like "Order total: $x".
function receipt(totalLine: string): RawEmail {
  return {
    id: "pipe-total",
    from: '"Fernhill Outfitters" <orders@fernhill.example>',
    subject: "Your Fernhill order #FH-20931",
    date: "2026-10-01T10:00:00Z",
    text: [
      "Thanks for your order! Our fall sale is on: 20% off everything, shop now.",
      "Order #FH-20931",
      "Ridgeline Rain Shell | $89.00",
      totalLine,
      "Unsubscribe from promotional emails",
    ].join("\n"),
  };
}

describe("classify: pipe-separated totals from HTML tables (#116)", () => {
  it("treats 'Order total | $x' as purchase evidence, like 'Order total: $x'", () => {
    expect(classify(receipt("Order total: $134.45")).class).toBe("order");
    expect(classify(receipt("Order total | $134.45")).class).toBe("order");
    expect(classify(receipt("Subtotal | USD 125.00")).class).toBe("order");
  });
});