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


describe("false positives: purchase data survives redaction (#123)", () => {
  const bareTo = { to: "customer@mail.example" };
  it.each(([
    "12800 JPY", "Total\n12800 JPY", "1299 PLN", "4500 SEK", "3000 円", "1500 Pts", "1500 Points", "2026 Spring Sale",
    "1234 Cotton Socks", "12345 Items shipped",
    "Color Red ID 12345", "Qty OR 10001", "SKU AB1 2CD", "Shipping WA 98101",
    "5 Boulevard Coffee Beans $12", "3 Avenue Trading Co Order #5 $12.00", "2 Route Planner Pro $9.99", "5 Rue Skinny Jeans $40",
    "Rue 21 Skinny Jeans", "Route 66 Tee", "Park Avenue Hotel", "4 Place Setting Dinnerware $50", "Shipped via Standard 5-7 days",
    "SKU +12345678", "+1234567 pts", "〒150-0002", "Postal code: 150-0002",
    "Order 1234 5678, call us if it is late", "Call by 2026-09-01", "Call 12.50 1,299.00",
  ]).map(text => ({ text })))("keeps $text untouched", ({ text }) => {
    const result = redact({ ...email(text), ...bareTo });
    expect(result.text).toBe(text);
    expect(result.redactions).toEqual({ pan: 0, phone: 0, address: 0, email: 0, name: 0 });
  });

  it.each(([
    ["Hi Amazon Customer,\nYour Amazon.com order of Amazon Basics is ready. Amazon", "Amazon <orders@amazon.example>"],
    ["Hello Nike Member,\nNike Air Max $120", "Nike <orders@nike.example>"],
    ["Hello Nike Member,\nNike Air Max $120", "Northwind <orders@northwind.example>"],
    ["Customer: Dr. Martens\nDr. Martens 1460 Boots $150", "Northwind <orders@northwind.example>"],
    ["Ship to: Acme Corp\nAcme Corp total $5", "Northwind <orders@northwind.example>"],
    ["Ship to: Home Office\nHome Office Chair $5", "Northwind <orders@northwind.example>"],
    ["Deliver to: Amazon Locker\nAmazon Locker pickup", "Northwind <orders@northwind.example>"],
    ["Name: Trail Runner\nTrail Runner $5", "Northwind <orders@northwind.example>"],
    ["Sold to: Acme Inc\nAcme Inc paid $5; Billing: Example LLC", "Northwind <orders@northwind.example>"],
  ] as Array<[string, string]>).map(([text, from]) => ({ text, from })))("does not mistake brands, organisations and products for customer names: $text", ({ text, from }) => {
    const result = redact({ ...email(text), ...bareTo, from });
    expect(result.text).toBe(text);
    expect(result.redactions.name).toBe(0);
  });

  it("redacts only the salutation for a first name, so brands, products and dates survive", () => {
    const hello = redact({ ...email("Hello Jordan,\nJordan 1 Retro $180\nOrder #5"), ...bareTo });
    expect(hello.text).toBe("Hello [NAME_1],\nJordan 1 Retro $180\nOrder #5");
    const will = redact({ ...email("Hi Will,\nI will ship it. Total $5"), ...bareTo });
    expect(will.text).toBe("Hi [NAME_1],\nI will ship it. Total $5");
    const may = redact({ ...email("Dear May,\nPlaced May 12, 2026 total $5"), ...bareTo });
    expect(may.text).toBe("Dear [NAME_1],\nPlaced May 12, 2026 total $5");
  });

  it("does not expand a first name from a salutation when the recipient is known from the To header", () => {
    const result = redact(email("Hello Jordan,\nJordan 1 Retro $180"));
    expect(result.text).toBe("Hello Jordan,\nJordan 1 Retro $180");
  });

  it("keeps prices and brand names around a redacted name and postal line", () => {
    const text = "Ship to:\nMaya Chen\n12 Maple Street\nLondon SW1A 2AA\nNike Air Max 12800 JPY\nTotal 12800 JPY";
    const result = redact({ ...email(text), ...bareTo });
    expect(result.text).toBe("Ship to:\n[NAME_1]\n[ADDRESS_1]\n[ADDRESS_2]\nNike Air Max 12800 JPY\nTotal 12800 JPY");
  });
});

describe("misses: PII that used to leak (#123)", () => {
  const bareTo = { to: "customer@mail.example" };
  it.each([
    "Call us 020 7946 0958", "Tel: 07911 123456", "Tél : 01 23 45 67 89", "Telefon: 030 1234567", "Mobile: 98765 43210",
    "Phone: 03-1234-5678", "Phone: 090-1234-5678", "Phone: 0412 345 678", "Call 0044 20 7946 0958", "Phone no. (020) 7946 0958",
    "Contact number 07911 123456 (mobile)",
  ])("redacts the national-format phone in %j", text => {
    const result = redact({ ...email(text), ...bareTo });
    expect(result.text).toMatch(/\[PHONE_1\]/);
    expect(result.text).not.toMatch(/\d{3}/);
    expect(result.redactions.phone).toBe(1);
  });

  it.each([
    ["Ship to 22 Acacia Gardens", "Ship to [ADDRESS_1]"],
    ["Ship to 9 Elm Close", "Ship to [ADDRESS_1]"],
    ["Ship to 4 Orchard Crescent", "Ship to [ADDRESS_1]"],
    ["Ship to 7 Market Square", "Ship to [ADDRESS_1]"],
    ["Berliner Str. 5", "[ADDRESS_1]"],
    ["Calle Mayor 12", "[ADDRESS_1]"],
    ["Via Roma 10", "[ADDRESS_1]"],
    ["Keizersgracht 123", "[ADDRESS_1]"],
    ["3 place de la République", "[ADDRESS_1]"],
    ["12 rue de Rivoli, 75001 Paris", "[ADDRESS_1] [ADDRESS_2]"],
    ["5 Rue Rivoli, 75001 Paris", "[ADDRESS_1] [ADDRESS_2]"],
    ["PO Box 123", "[ADDRESS_1]"],
    ["Ship to: 456 Queen St W, Toronto ON M5V 2B7", "Ship to: [ADDRESS_1] [ADDRESS_2]"],
    ["Deliver to 22 Acacia Gardens, Leeds LS1 4AP", "Deliver to [ADDRESS_1] [ADDRESS_2]"],
    ["Musterstraße 12, 80331 München", "[ADDRESS_1] [ADDRESS_2]"],
    ["Ship to:\n10115 Berlin\nTotal 12800 JPY", "Ship to:\n[ADDRESS_1]\nTotal 12800 JPY"],
    ["Ship to:\nMaya Chen\nSpringfield IL 62704", "Ship to:\n[NAME_1]\n[ADDRESS_1]"],
  ])("redacts the address in %j", (text, expected) => {
    const result = redact({ ...email(text), ...bareTo });
    expect(result.text).toBe(expected);
  });

  it.each([
    ["Thanks for your order, Priya Natarajan!", "Thanks for your order, [NAME_1]!"],
    ["Account holder: Jane Doe", "Account holder: [NAME_1]"],
    ["Order for Jane Doe", "Order for [NAME_1]"],
    ["Order for: Jane Doe", "Order for: [NAME_1]"],
    ["Placed by Jane Doe", "Placed by [NAME_1]"],
    ["Cardholder: JANE DOE", "Cardholder: [NAME_1]"],
    ["Name on card: Jane Doe", "Name on card: [NAME_1]"],
    ["Name: Jane Doe\nPhone: 555-0123", "Name: [NAME_1]\nPhone: [PHONE_1]"],
  ])("redacts the name in %j without a To display name", (text, expected) => {
    expect(redact({ ...email(text), ...bareTo }).text).toBe(expected);
  });

  it("tokenizes the surname and honorific forms when the To name is known", () => {
    const result = redact({ ...email("Dear Ms. Rivera,\nMs Rivera will pick it up\nRivera household"), to: "Jane Rivera <jane@mail.example>" });
    expect(result.text).not.toMatch(/Rivera/);
    const short = redact({ ...email("Dear Ms. Doe,\nDoe party"), to: "Jane Doe <jane@mail.example>" });
    expect(short.text).toBe("Dear [NAME_1],\nDoe party");
  });

  it('handles a To display name written as "Doe, Jane"', () => {
    const result = redact({ ...email("Hi Jane,\nJane Doe and Doe, Jane both ordered"), to: '"Doe, Jane" <jane@mail.example>' });
    expect(result.text).not.toMatch(/Jane|Doe/);
  });
});
