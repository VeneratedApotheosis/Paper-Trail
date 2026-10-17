import { describe, expect, it } from "vitest";
import { ClassificationSchema, type EmailClass, type RawEmail } from "@/lib/contracts";
import { classify } from "./classify";
import { redact } from "./redact";

// Synthetic fixtures only: fictional stores on .example domains, fake customer Sam Rivera.
const NORTHWIND = '"Northwind Outfitters" <orders@northwind.example>';

function email(subject: string, text: string, from = NORTHWIND): RawEmail {
  return { id: `m-${subject.length}`, from, subject, date: "2026-09-01T10:00:00Z", text };
}

describe("classify: lifecycle classes", () => {
  const cases: Array<[EmailClass, RawEmail]> = [
    [
      "order",
      email(
        "Order confirmation #NW-1001",
        "Hi Sam, thank you for your order!\nTrail Runner x1 $129.99\nOrder total: $140.39\nWe'll let you know when it's on its way.",
      ),
    ],
    ["order", email("Your Northwind order #NW-1001", "Order summary\nTrail Runner $129.99")],
    [
      "shipped",
      email("Your order #NW-1001 has shipped", "Good news, your order has shipped and will be delivered Friday.\nTracking number: 1Z999AA10123456784"),
    ],
    ["delivered", email("Delivered: your order #NW-1001", "Your package was delivered on Sep 5 to the front door.")],
    [
      "return_started",
      email("Your return label is ready", "Your return request has been approved. Print the attached return label for order #NW-1001."),
    ],
    [
      "return_received",
      email("We received your return", "We've received your return for order #NW-1001. Your refund will be processed in 5-7 days."),
    ],
    [
      "refund",
      email("Your refund has been issued", "We've issued a refund of $129.99 to your Visa ending in 4242 for order #NW-1001."),
    ],
    [
      "price_adjust",
      email("Price adjustment for order #NW-1001", "A price adjustment of $20.00 has been issued to your original payment method."),
    ],
    [
      "cancel",
      email("Your order #NW-1001 has been cancelled", "Your order was cancelled before it shipped. No charge was made."),
    ],
  ];

  it.each(cases)("classifies %s", (expected, input) => {
    const result = classify(input);
    expect(ClassificationSchema.parse(result)).toBeTruthy();
    expect(result.class).toBe(expected);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.emailId).toBe(input.id);
  });

  it("uses body wording when the subject is generic", () => {
    const result = classify(email("Update on #NW-1001", "Your order has been delivered to the front porch."));
    expect(result.class).toBe("delivered");
    expect(result.confidence).toBeCloseTo(0.75);
  });

  it("does not mistake future delivery wording for delivered", () => {
    expect(classify(email("Your package will be delivered Tuesday", "Out for delivery soon.")).class).toBe("shipped");
  });

  it("does not treat a refund request acknowledgement as an issued refund", () => {
    const result = classify(email("Refund request received for order #NW-1001", "We received your refund request."));
    expect(result.class).not.toBe("refund");
  });

  it("is ambiguous (< 0.7) with only an order number", () => {
    const result = classify(email("Hello Sam", "Regarding order #NW-1001, see the attached details."));
    expect(result.class).toBe("order");
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("classifies personal mail as not_receipt", () => {
    const result = classify(email("Lunch tomorrow?", "Tacos at noon?", '"Jordan Lee" <jordan@mail.example>'));
    expect(result.class).toBe("not_receipt");
  });
});

describe("classify: Spanish", () => {
  const cases: Array<[EmailClass, string, string]> = [
    ["order", "Confirmación de tu pedido #MX-5521", "¡Gracias por tu compra, Sam! Resumen del pedido: Mochila $899.00 MXN"],
    ["shipped", "Tu pedido #MX-5521 ha sido enviado", "Tu pedido está en camino."],
    ["delivered", "Tu pedido #MX-5521 fue entregado", "Tu pedido ha sido entregado."],
    ["refund", "Tu reembolso del pedido #MX-5521", "Hemos procesado tu reembolso de $899.00 MXN."],
    ["return_received", "Devolución recibida - pedido #MX-5521", "Hemos recibido tu devolución."],
  ];

  it.each(cases)("classifies %s", (expected, subject, text) => {
    const result = classify(email(subject, text, '"Tienda Sol" <pedidos@tiendasol.example>'));
    expect(result.class).toBe(expected);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe("classify: marketing never becomes an order", () => {
  it("labels a promo email with prices as marketing", () => {
    const result = classify(
      email(
        "Last chance: 30% off everything",
        "Shop now! New arrivals from $49.99. Use code FALL30 at checkout. Free shipping on your next order.\nUnsubscribe",
        '"Northwind Outfitters" <deals@northwind.example>',
      ),
    );
    expect(result.class).toBe("marketing");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("does not let a shipping-sounding promo subject override promo language", () => {
    const result = classify(
      email("Your deals are on the way", "Shop now: 20% off sitewide.\nUnsubscribe", '"Northwind Outfitters" <news@northwind.example>'),
    );
    expect(result.class).toBe("marketing");
  });

  it("labels a price-drop promo as marketing, not price_adjust", () => {
    const result = classify(
      email(
        "Price drop on the Trail Runner",
        "Prices just dropped: Trail Runner now $99.99 (was $129.99). Shop the sale.\nUnsubscribe",
        '"Northwind Outfitters" <news@northwind.example>',
      ),
    );
    expect(result.class).toBe("marketing");
  });

  it("keeps a real order confirmation with a promo footer as an order", () => {
    const result = classify(
      email(
        "Order confirmation #NW-1002",
        "Thank you for your order! Order total: $59.00\nEnjoy 15% off your next purchase with code THANKS15.\nUnsubscribe",
      ),
    );
    expect(result.class).toBe("order");
  });
});

describe("classify: phishing look-alikes never become orders", () => {
  it("flags a digit-for-letter look-alike domain with urgent verification language", () => {
    const result = classify(
      email(
        "Urgent: verify your card to keep order #NW-2231",
        "Your order #NW-2231 is on hold. Click here to verify your card details within 24 hours or your account will be suspended.",
        '"Northwind Outfitters" <security@n0rthwind-support.example>',
      ),
    );
    expect(result.class).toBe("not_receipt");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.reason).toContain("phishing");
  });

  it("flags a look-alike domain even with receipt-like wording", () => {
    const result = classify(
      email(
        "Order confirmation #NW-2232",
        "Thank you for your order! Order total: $899.00",
        '"Northwind Outfitters" <orders@n0rthwind.example>',
      ),
    );
    expect(result.class).toBe("not_receipt");
    expect(result.reason).toContain("look-alike sender domain n0rthwind.example");
  });

  it("flags a look-alike domain without a display name", () => {
    expect(classify(email("Order confirmation #NW-2233", "Thank you for your order!", "orders@n0rthwind.example")).class).toBe(
      "not_receipt",
    );
  });

  it("never classifies a sender whose domain does not match the claimed brand as an order", () => {
    const result = classify(
      email(
        "Order confirmation #NW-2234",
        "Thank you for your order! Order total: $45.00",
        '"Northwind Outfitters" <receipts@quickmail-notices.example>',
      ),
    );
    expect(result.class).toBe("not_receipt");
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("flags urgent verification language from an unknown sender", () => {
    const result = classify(
      email(
        "Problem with your recent purchase",
        "Unusual activity was detected. Update your payment information to avoid cancellation.",
        "billing@shop-alerts.example",
      ),
    );
    expect(result.class).toBe("not_receipt");
  });

  it("accepts payment-wrapper senders whose name matches the domain", () => {
    const result = classify(
      email("Receipt for your payment to Atlas Home", "You sent a payment of $240.00. Payment received.", '"PayBridge" <service@paybridge.example>'),
    );
    expect(result.class).toBe("order");
  });
});

describe("classify: forwarded emails", () => {
  const forwarded = [
    "Can you check this one?",
    "",
    "---------- Forwarded message ---------",
    "From: Northwind Outfitters <orders@northwind.example>",
    "Date: Mon, Sep 1, 2026 at 10:00 AM",
    "Subject: Your refund has been issued",
    "To: Sam Rivera <sam.rivera@mail.example>",
    "",
    "We've issued a refund of $129.99 for order #NW-1001.",
  ].join("\n");

  it("classifies by the inner message", () => {
    const result = classify(email("Fwd: Your refund has been issued", forwarded, '"Sam Rivera" <sam.rivera@mail.example>'));
    expect(result.class).toBe("refund");
    expect(result.confidence).toBeCloseTo(0.9);
    expect(result.reason).toMatch(/^forwarded; /);
  });

  it("lowers confidence when the inner sender is unknown (redacted address)", () => {
    const raw = email("Fwd: Your refund has been issued", forwarded, '"Sam Rivera" <sam.rivera@mail.example>');
    const result = classify(redact(raw));
    expect(result.class).toBe("refund");
    expect(result.confidence).toBeCloseTo(0.8);
    expect(result.reason).toContain("original sender unknown");
  });

  it("runs phishing checks on the inner sender", () => {
    const text = [
      "---------- Forwarded message ---------",
      "From: Northwind Outfitters <orders@n0rthwind.example>",
      "Subject: Order confirmation #NW-2235",
      "",
      "Thank you for your order!",
    ].join("\n");
    expect(classify(email("Fwd: Order confirmation #NW-2235", text, '"Sam Rivera" <sam.rivera@mail.example>')).class).toBe(
      "not_receipt",
    );
  });

  it("handles a Fwd: subject without forwarded headers", () => {
    const result = classify(
      email("Fwd: Your Northwind order has shipped", "Your order has shipped.", '"Sam Rivera" <sam.rivera@mail.example>'),
    );
    expect(result.class).toBe("shipped");
    expect(result.confidence).toBeCloseTo(0.8);
  });

  it("handles Spanish forwarded headers", () => {
    const text = [
      "---------- Mensaje reenviado ---------",
      "De: Tienda Sol <pedidos@tiendasol.example>",
      "Asunto: Tu pedido #MX-5521 ha sido enviado",
      "",
      "Tu pedido está en camino.",
    ].join("\n");
    const result = classify(email("RV: Tu pedido", text, '"Sam Rivera" <sam.rivera@mail.example>'));
    expect(result.class).toBe("shipped");
  });
});

describe("classify: determinism", () => {
  it("returns identical results for identical input", () => {
    const input = email("Your order #NW-1001 has shipped", "Your order has shipped.");
    expect(classify(input)).toEqual(classify(input));
  });
});
