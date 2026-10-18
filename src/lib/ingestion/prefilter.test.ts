import { describe, expect, it } from "vitest";
import type { RawEmail } from "@/lib/contracts";
import { GMAIL_RECEIPT_QUERY, describePrefilterQuery, isReceiptLike } from "./prefilter";

// Synthetic fixtures only: fictional stores on .example domains.
function email(overrides: Partial<RawEmail>): RawEmail {
  return {
    id: "m-prefilter",
    from: '"Sam Rivera" <sam.rivera@mail.example>',
    subject: "",
    date: "2026-09-01T10:00:00Z",
    text: "",
    ...overrides,
  };
}

describe("GMAIL_RECEIPT_QUERY", () => {
  it("limits to 90 days and covers receipt subjects and senders", () => {
    expect(GMAIL_RECEIPT_QUERY.startsWith("newer_than:90d ")).toBe(true);
    for (const term of ["order", "receipt", "shipped", "delivered", "return", "refund", '"price adjustment"', "invoice"]) {
      expect(GMAIL_RECEIPT_QUERY).toContain(term);
    }
    expect(GMAIL_RECEIPT_QUERY).toContain("from:(orders OR receipts");
    expect(GMAIL_RECEIPT_QUERY).toBe(
      'newer_than:90d (subject:(order OR receipt OR shipped OR delivered OR return OR refund OR "price adjustment" OR invoice OR pedido OR reembolso OR devolución OR shipment OR tracking OR package OR "out for delivery" OR arriving OR 出貨 OR 配送 OR 取貨 OR 到店 OR 送達 OR 簽收 OR 訂單) OR from:(orders OR receipts OR shipping OR returns OR refunds OR billing OR auto-confirm OR shipment-tracking OR ups OR fedex OR usps OR dhl OR shopee))',
    );
  });

  it("is described in plain language with the exact query", () => {
    const description = describePrefilterQuery();
    expect(description).toContain("last 90 days");
    expect(description).toContain("never fetched");
    expect(description).toContain(GMAIL_RECEIPT_QUERY);
  });
});

describe("isReceiptLike", () => {
  it("keeps receipt-like subjects, including Spanish", () => {
    expect(isReceiptLike(email({ subject: "Your Northwind order has shipped" }))).toEqual({
      keep: true,
      reason: 'subject mentions "order"',
    });
    expect(isReceiptLike(email({ subject: "Tu reembolso está en camino" })).keep).toBe(true);
    expect(isReceiptLike(email({ subject: "Devolución recibida" })).reason).toBe('subject mentions "devolucion"');
  });

  it("keeps transactional senders", () => {
    const decision = isReceiptLike(email({ from: "Kestrel <auto-confirm@kestrel.example>", subject: "Thanks!" }));
    expect(decision).toEqual({ keep: true, reason: 'transactional sender "auto-confirm@"' });
  });

  it("keeps emails with an order number", () => {
    const decision = isReceiptLike(
      email({ from: "Atlas Home <hello@atlashome.example>", subject: "Update", text: "Re: order #AH-55120" }),
    );
    expect(decision).toEqual({ keep: true, reason: "contains an order number" });
  });

  it("keeps bodies with several receipt keywords", () => {
    const decision = isReceiptLike(
      email({ from: "Lumen <hello@lumen.example>", subject: "Thanks!", text: "Subtotal $40.00\nTotal $43.20\nQty 1" }),
    );
    expect(decision.keep).toBe(true);
  });

  it("drops personal and newsletter mail", () => {
    expect(isReceiptLike(email({ subject: "Lunch tomorrow?", text: "Want to grab tacos at noon?" }))).toEqual({
      keep: false,
      reason: "no receipt keywords, transactional sender, or order number",
    });
    expect(
      isReceiptLike(email({ from: "Trail Weekly <news@trailweekly.example>", subject: "5 hikes for fall", text: "Read more" }))
        .keep,
    ).toBe(false);
  });
});
