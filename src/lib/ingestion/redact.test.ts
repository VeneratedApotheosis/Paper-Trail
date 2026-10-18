import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RedactedEmailSchema, type RawEmail } from "@/lib/contracts";
import { passesLuhn, redact } from "./redact";

// Synthetic fixtures only: fictional stores on .example domains, fake customer Sam Rivera, 555-01xx phones.
function email(text: string, subject = "Your Northwind order #NW-1001"): RawEmail {
  return {
    id: "m-redact",
    from: '"Northwind Outfitters" <orders@northwind.example>',
    to: "Sam Rivera <sam.rivera@mail.example>",
    subject,
    date: "2026-09-01T10:00:00Z",
    text,
    html: "<p>should be dropped</p>",
  };
}

describe("redact", () => {
  it("returns a contract-valid RedactedEmail without html", () => {
    const result = redact(email("Thanks for your order."));
    expect(RedactedEmailSchema.parse(result)).toBeTruthy();
    expect("html" in result).toBe(false);
    expect(result.redactions).toEqual({ pan: 0, phone: 0, address: 0, email: 0, name: 0 });
  });

  it("redacts Luhn-valid card numbers with spaces, dashes, or none", () => {
    const result = redact(
      email("Card: 4111 1111 1111 1111\nBackup card 5555-5555-5555-4444\nAmex 378282246310005"),
    );
    expect(result.text).toBe("Card: [PAN_1]\nBackup card [PAN_2]\nAmex [PAN_3]");
    expect(result.redactions.pan).toBe(3);
  });

  it("keeps last-4 mentions and masked cards", () => {
    const text = "Paid with Visa ending in 4242 (**** **** **** 4242).";
    expect(redact(email(text)).text).toBe(text);
  });

  it("does not redact Luhn-invalid digit runs", () => {
    const text = "Reference code 4111 1111 1111 1112 and batch 1234567890123";
    expect(passesLuhn("4111111111111112")).toBe(false);
    expect(redact(email(text)).text).toBe(text);
  });

  it("does not redact labeled order or tracking numbers even when they pass Luhn", () => {
    expect(passesLuhn("4111111111111111")).toBe(true);
    const text = [
      "Order number: 4111111111111111",
      "Tracking #: 9400 1000 0000 0000 0000 00",
      "Tracking number: 1Z999AA10123456784",
      "FedEx tracking: 4111111111111111",
    ].join("\n");
    expect(redact(email(text)).text).toBe(text);
  });

  it("redacts a card number even when an order label is nearby", () => {
    const result = redact(email("Order total charged to card number: 4111 1111 1111 1111"));
    expect(result.text).toBe("Order total charged to card number: [PAN_1]");
  });

  it("redacts US phone formats", () => {
    const result = redact(
      email(
        [
          "Call 555-0123",
          "Desk (555) 012-3456",
          "Mobile 555.012.3457",
          "Intl +1 555 012 3458",
          "Alt +1-555-012-3459",
          "Phone no: 555-0199",
        ].join("\n"),
      ),
    );
    expect(result.text).toBe(
      ["Call [PHONE_3]", "Desk [PHONE_4]", "Mobile [PHONE_5]", "Intl [PHONE_1]", "Alt [PHONE_2]", "Phone no: [PHONE_6]"].join(
        "\n",
      ),
    );
    expect(result.redactions.phone).toBe(6);
  });

  it("redacts street addresses with unit and city/state/zip", () => {
    const result = redact(
      email(
        [
          "Ship to: Sam Rivera, 742 Maple Ave, Apt 3B, Springfield, IL 62704",
          "Billing: 18 Harbor Point Blvd",
          "Store: 4100 Old Mill Rd. Suite 200",
          "Return to 9 Cedar Lane",
          "Warehouse 1200 Lakeshore Dr #14",
          "Office 55 W 5th Street",
          "Pickup 300 Quarry Way",
        ].join("\n"),
      ),
    );
    expect(result.text).toBe(
      [
        "Ship to: [NAME_1], [ADDRESS_1]",
        "Billing: [ADDRESS_2]",
        "Store: [ADDRESS_3]",
        "Return to [ADDRESS_4]",
        "Warehouse [ADDRESS_5]",
        "Office [ADDRESS_6]",
        "Pickup [ADDRESS_7]",
      ].join("\n"),
    );
    expect(result.redactions.address).toBe(7);
  });

  it("redacts email addresses in the body", () => {
    const result = redact(email("Receipt sent to sam.rivera@mail.example. Questions? help@northwind.example"));
    expect(result.text).toBe("Receipt sent to [EMAIL_1]. Questions? [EMAIL_2]");
    expect(result.redactions.email).toBe(2);
  });

  it("does not touch order numbers, prices, dates, SKUs, or quantities", () => {
    const text = [
      "Order #NW-1001 placed 2026-09-01 (09/01/2026, Sep 1, 2026 10:42 AM)",
      "Order number: 112-4455667-8899001",
      "SKU: NW-TR-2210-BLK  Qty 2  $129.99",
      "SKU 123-4567",
      "Item 4021-9981 Trail Runner Size 10",
      "Subtotal $259.98  Tax $21.45  Total $1,281.43",
      "Return within 30 days. Ships in 3-5 business days.",
      "Pedido n.º 8841-2203 total €45,90",
      "2 Pack Court Shoes $59.00",
    ].join("\n");
    const result = redact(email(text));
    expect(result.text).toBe(text);
    expect(result.redactions).toEqual({ pan: 0, phone: 0, address: 0, email: 0, name: 0 });
  });

  it("maps the same value to the same token across subject and body", () => {
    const result = redact(
      email(
        "Call (555) 012-3456 or 555-012-3456. Card 4111 1111 1111 1111, again 4111-1111-1111-1111. Email SAM.RIVERA@mail.example or sam.rivera@mail.example. Other: 555-0150",
        "Questions? Call 555-012-3456",
      ),
    );
    expect(result.subject).toBe("Questions? Call [PHONE_1]");
    expect(result.text).toBe(
      "Call [PHONE_1] or [PHONE_1]. Card [PAN_1], again [PAN_1]. Email [EMAIL_1] or [EMAIL_1]. Other: [PHONE_2]",
    );
    expect(result.redactions).toEqual({ pan: 2, phone: 4, address: 0, email: 2, name: 0 });
  });

  it("redacts PII in the subject line", () => {
    const result = redact(email("Body", "Delivery to 742 Maple Ave for sam.rivera@mail.example"));
    expect(result.subject).toBe("Delivery to [ADDRESS_1] for [EMAIL_1]");
  });

  it("hashes the redacted text with sha256 deterministically", () => {
    const first = redact(email("Call 555-0123 about order #NW-1001"));
    const second = redact(email("Call 555-0123 about order #NW-1001"));
    const expected = createHash("sha256").update("Call [PHONE_1] about order #NW-1001").digest("hex");
    expect(first.textHash).toBe(expected);
    expect(second).toEqual(first);
    // Different PII, same redacted text -> same cache key.
    expect(redact(email("Call 555-0188 about order #NW-1001")).textHash).toBe(expected);
  });

  it("passes headers through and keeps optional fields", () => {
    const result = redact({ ...email("x"), threadId: "t1", labels: ["INBOX"] });
    expect(result.from).toBe('"Northwind Outfitters" <orders@northwind.example>');
    expect(result.threadId).toBe("t1");
    expect(result.labels).toEqual(["INBOX"]);
  });
});

describe("international and name privacy", () => {
  it.each(["+44 20 7946 0958", "+33 1 23 45 67 89", "+442079460958", "+44 (0)20 7946 0958", "Phone: 4155550142", "Mobile: 14155550142", "4155550142 (phone)"])("redacts phone %s", phone => {
    expect(redact(email(phone)).text.replace(/\[PHONE_\d+\]/g, "")).not.toMatch(/\d/);
    expect(redact(email(phone)).redactions.phone).toBe(1);
  });
  it("preserves bare order ids, SKUs and amounts without phone context", () => {
    const text = "Order: 4155550142\nSKU: 14155550142\nTotal: 199.95\nDate: 2026-10-17";
    expect(redact(email(text)).text).toBe(text);
  });
  it.each([
    "Hauptstrasse 5, 10115 Berlin", "12 rue de Rivoli, 75001 Paris",
    "742 Maple Ave\nSpringfield, IL 62704", "12 Maple Street\nToronto, ON M5V 2T6",
    "742 Maple Ave\n10115 Berlin", "12 Maple Street\nLondon SW1A 2AA",
  ])("redacts street and postal line: %s", address => {
    const text = redact(email(`${address}\nOrder #NW-1001\nTotal: $59.99`)).text;
    expect(text).not.toMatch(/Maple|Berlin|Paris|London|Toronto|62704|M5V|SW1A|10115|75001/);
    expect(text).toContain("Order #NW-1001\nTotal: $59.99");
  });
  it("redacts known full/first names in subject and body with truthful counts", () => {
    const result = redact(email("Hi Sam,\nCustomer: Sam Rivera\nShip to:\nSam Rivera\nSam bought a Trail Runner for $20.", "Sam Rivera receipt"));
    expect(result.subject + result.text).not.toMatch(/Sam|Rivera/);
    expect(result.redactions.name).toBe(5);
    expect(result.text).toContain("Trail Runner for $20");
  });
  it.each(["Dear Élodie Martin,", "Customer name: Maya Chen", "Ship to:\nMaya Chen\n12 Maple Street"])("finds customer names without a recipient display name: %s", text => {
    const result = redact({ ...email(text), to: "customer@mail.example" });
    expect(result.redactions.name).toBeGreaterThan(0);
    expect(result.text).not.toMatch(/Élodie|Martin|Maya|Chen/);
  });
});


describe("names overlapping purchase facts", () => {
  it.each(["May 4, 2026", "4 May 2026", "May 2026", "May 4th, 2026"])("preserves date %s while redacting the customer", date => {
    const result = redact({ ...email(`Hi May,\nCustomer: May Rivera\nPurchased ${date}.\nOrder #MAY-1001\nSKU: MAY/2026`), to: "May Rivera <customer@mail.example>" });
    expect(result.text).toContain(date);
    expect(result.text).toContain("Order #MAY-1001");
    expect(result.text).toContain("SKU: MAY/2026");
    expect(result.text).not.toContain("Hi May");
    expect(result.text).not.toContain("Customer: May Rivera");
    expect(result.redactions.name).toBe(2);
  });
  it("preserves standalone labeled references without losing personal name occurrences", () => {
    const result = redact(email("Order ref: SAM\nTracking: SAM\nHi Sam,\nCustomer: Sam Rivera"));
    expect(result.text).toContain("Order ref: SAM");
    expect(result.text).toContain("Tracking: SAM");
    expect(result.redactions.name).toBe(2);
  });
});
