import { describe, expect, it } from "vitest";
import { EmailParseError, htmlToText, parseEml, parseMbox, parseMboxDetailed } from "./eml";

const crlf = (lines: string[]) => lines.join("\r\n");

describe("parseEml", () => {
  it("parses a plain message with folded and encoded headers", () => {
    const email = parseEml(
      crlf([
        'From: "Northwind Outfitters"',
        " <orders@northwind.example>",
        "To: sam@mail.example",
        "Subject: =?UTF-8?Q?Your_order_=E2=80=94_NW-1001?=",
        "Date: Wed, 01 Oct 2026 10:00:00 -0700",
        "Message-ID: <abc123@northwind.example>",
        "",
        "Thanks for your order.",
      ]),
    );
    expect(email).toEqual({
      id: "abc123@northwind.example",
      from: '"Northwind Outfitters" <orders@northwind.example>',
      to: "sam@mail.example",
      subject: "Your order — NW-1001",
      date: "2026-10-01T17:00:00.000Z",
      text: "Thanks for your order.",
    });
  });

  it("prefers text/plain in multipart/alternative and decodes quoted-printable", () => {
    const email = parseEml(
      [
        "From: orders@northwind.example",
        "Subject: Order NW-1002",
        "Date: Thu, 02 Oct 2026 09:00:00 +0000",
        'Content-Type: multipart/alternative; boundary="b1"',
        "",
        "--b1",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<p>HTML version</p>",
        "--b1",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "Total: =E2=82=AC40.00, caf=C3=A9 =",
        "mug",
        "--b1--",
      ].join("\n"),
    );
    expect(email.text).toBe("Total: €40.00, café mug");
    expect(email.id).toMatch(/^eml-[0-9a-f]{16}$/);
  });

  it("decodes base64 parts nested in multipart/mixed and skips attachments", () => {
    const body = Buffer.from("Order total: $12.50\nThanks!", "utf8").toString("base64");
    const email = parseEml(
      [
        "From: orders@grandmart.example",
        "Subject: Receipt",
        "Date: 2026-10-03T12:00:00Z",
        'Content-Type: multipart/mixed; boundary="outer"',
        "",
        "--outer",
        'Content-Type: multipart/alternative; boundary="inner"',
        "",
        "--inner",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        body,
        "--inner--",
        "--outer",
        "Content-Type: text/plain",
        "Content-Disposition: attachment; filename=terms.txt",
        "",
        "Attachment text",
        "--outer--",
      ].join("\n"),
    );
    expect(email.text).toBe("Order total: $12.50\nThanks!");
  });

  it("falls back to HTML converted to text", () => {
    const email = parseEml(
      [
        "From: orders@voltline.example",
        "Subject: Shipped",
        "Date: 2026-10-04T12:00:00Z",
        "Content-Type: text/html; charset=windows-1252",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "<html><style>p{}</style><body><p>Your order has shipped&nbsp;=96 track it</p>Total&amp;tax: $5<br>Thanks</body></html>",
      ].join("\n"),
    );
    expect(email.text).toBe("Your order has shipped – track it\nTotal&tax: $5\nThanks");
  });

  it("rejects messages without From or a valid Date", () => {
    expect(() => parseEml("Subject: hi\nDate: 2026-10-01T00:00:00Z\n\nbody")).toThrow(EmailParseError);
    expect(() => parseEml("From: a@b.example\nDate: someday\n\nbody")).toThrow(/Date header/);
  });
});

describe("htmlToText", () => {
  it("decodes numeric entities and collapses whitespace", () => {
    expect(htmlToText("<div>A&#36;1  &#x41;</div>\n\n\n<div>B</div>")).toBe("A$1 A\n\nB");
  });
});

describe("parseMbox", () => {
  const mbox = [
    "From orders@northwind.example Wed Oct  1 10:00:00 2026",
    "From: orders@northwind.example",
    "Subject: Order NW-1",
    "Date: 2026-10-01T10:00:00Z",
    "Message-ID: <m1@x>",
    "",
    "First body",
    ">From the team",
    "",
    "From orders@grandmart.example Thu Oct  2 10:00:00 2026",
    "From: orders@grandmart.example",
    "Subject: Order GM-2",
    "Date: 2026-10-02T10:00:00Z",
    "Message-ID: <m2@x>",
    "",
    "Second body",
    "",
    "From nobody Fri Oct  3 10:00:00 2026",
    "Subject: no sender",
    "",
    "Third body",
  ].join("\n");

  it("splits messages and unescapes >From lines", () => {
    const emails = parseMbox(mbox);
    expect(emails.map((email) => email.id)).toEqual(["m1@x", "m2@x"]);
    expect(emails[0].text).toBe("First body\nFrom the team");
    expect(emails[1].subject).toBe("Order GM-2");
  });

  it("reports unparseable messages instead of hiding them", () => {
    expect(parseMboxDetailed(mbox).errors).toEqual([{ index: 2, reason: "missing From header" }]);
  });
});
