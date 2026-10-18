import { describe, expect, it } from "vitest";
import type { RawEmail } from "@/lib/contracts";
import { classify } from "./classify";

// Real-inbox misses labelled via /eval (#117). Synthetic look-alikes; no real data.
const mail = (from: string, subject: string, text: string): RawEmail => ({ id: "x", from, subject, date: "2026-10-04T12:00:00Z", text });

describe("classify: receipts sent through another company's system", () => {
  it("keeps a campus dining receipt sent by a campus card system", () => {
    const verdict = classify(mail('"Campus Dining" <noreply@transactcampus.com>', "#128580688 Receipt",
      ["Receipt #128580688", "Location: North Hall Cafe", "Bowl | 1 | $9.50", "Subtotal: $9.50", "Total: $9.50", "Paid with: Meal plan"].join("\n")));
    expect(verdict.class).toBe("order");
  });

  it("keeps a shipping update with an order number and tracking from a storefront domain", () => {
    const verdict = classify(mail('"Bowl Keys" <store@t.shopifyemail.com>', "A shipment from order #BK-9129 is on the way",
      "Your order #BK-9129 has shipped. Tracking number: 1Z999AA10123456784. Track your package."));
    expect(verdict.class).toBe("shipped");
  });

  it("still rejects a brand claim on an unrelated domain, even with an order number and total", () => {
    expect(classify(mail('"Amazon.com" <orders@random-mailer.example>', "Your order #112-3456789-0123456", "Thanks for your order! Order total: $59.99")).class).not.toBe("order");
  });
});

describe("classify: 'order has been received' wording", () => {
  it("treats 'Your Whole Foods Market order has been received' as an order", () => {
    const verdict = classify(mail('"Amazon.com" <no-reply@amazon.com>', "Your Whole Foods Market order has been received",
      ["Hi there,", "Your Whole Foods Market order has been received.", "Order #112-3456789-0123456", "Bananas | $1.20", "Order total: $34.80"].join("\n")));
    expect(verdict.class).toBe("order");
  });
});
