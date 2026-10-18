import { describe, expect, it } from "vitest";
import type { RawEmail } from "@/lib/contracts";
import { decodeGmailMessageDetailed } from "@/lib/gmail/decode";
import { parseEmlDetailed } from "@/lib/demo/eml";
import { redact } from "./redact";
import { HTML_RECEIPT_FIXTURES, type HtmlReceiptFixture } from "./fixtures/html-receipts";
import { MAX_HTML_TEXT_CHARS, htmlToText, selectBodyText } from "./mime";

const base64url = (value: string) => Buffer.from(value, "utf8").toString("base64url");

function gmailMessage(fixture: HtmlReceiptFixture) {
  const parts = [
    ...(fixture.plain === null ? [] : [{ mimeType: "text/plain", body: { data: base64url(fixture.plain) } }]),
    { mimeType: "text/html", body: { data: base64url(fixture.html) } },
  ];
  return {
    id: "fixture-1",
    internalDate: "1791100800000",
    payload: {
      mimeType: "multipart/alternative",
      headers: [{ name: "From", value: fixture.from }, { name: "Subject", value: fixture.subject }],
      parts,
    },
  };
}

function emlSource(fixture: HtmlReceiptFixture): string {
  const section = (type: string, body: string) =>
    ["", "--b1", `Content-Type: ${type}; charset=utf-8`, "Content-Transfer-Encoding: base64", "", Buffer.from(body, "utf8").toString("base64")].join("\n");
  return [
    `From: ${fixture.from}`,
    `Subject: ${fixture.subject}`,
    "Date: Mon, 05 Oct 2026 12:00:00 +0000",
    "Message-ID: <fixture-1@mail.example>",
    'Content-Type: multipart/alternative; boundary="b1"',
    section("text/html", fixture.html),
    ...(fixture.plain === null ? [] : [section("text/plain", fixture.plain)]),
    "--b1--",
  ].join("\n");
}

describe("htmlToText", () => {
  it("keeps one line per table row with cells joined by ' | ' and drops empty cells", () => {
    const html = `<table><tr><td>Hydrating Cleanser</td><td>1</td><td>$22.00</td></tr>
      <tr><td>Subtotal</td><td></td><td>$22.00</td></tr><tr><td><b>Order total</b></td><td></td><td><b>$23.76</b></td></tr></table>`;
    expect(htmlToText(html)).toBe("Hydrating Cleanser | 1 | $22.00\nSubtotal | $22.00\nOrder total | $23.76");
  });

  it("emits nested layout tables as their own rows and keeps single-cell wrappers multi-line", () => {
    const html = `<table><tr><td><h1>Thanks, Sam</h1><p>Order #A-100</p>
      <table><tr><td>Mug</td><td>$8.00</td></tr><tr><td>Total</td><td>$8.00</td></tr></table>
      <p>See you soon</p></td></tr></table>`;
    expect(htmlToText(html)).toBe("Thanks, Sam\nOrder #A-100\nMug | $8.00\nTotal | $8.00\nSee you soon");
  });

  it("prefixes list items, puts headings and paragraphs on their own lines, and joins <br> cell lines", () => {
    expect(htmlToText("<h2>In this box</h2><ul><li>Lamp</li><li>Cable <b>x2</b></li></ul><p>Thanks!</p>")).toBe("In this box\n- Lamp\n- Cable x2\nThanks!");
    expect(htmlToText("<table><tr><td>Mug<br>Blue</td><td>$8.00</td></tr></table>")).toBe("Mug, Blue | $8.00");
  });

  it("drops script/style/head, comments, conditional comments, hidden elements and preheaders", () => {
    const html = `<html><head><title>T</title><style>p{}</style></head><body>
      <!--[if mso]><table><tr><td><![endif]-->
      <div style="display: none; max-height:0">Preview text $1.00</div>
      <span class="preheader">Another preview</span>
      <div style="mso-hide:all">Outlook hidden</div>
      <p>Visible <span hidden>secret <b>inner</b></span>text</p>
      <script>track()</script><!--[if mso]></td></tr></table><![endif]--></body></html>`;
    expect(htmlToText(html)).toBe("Visible text");
  });

  it("drops tracking pixels and decorative images but keeps product alt text", () => {
    const html = `<img src="x" width="1" height="1" alt="pixel"><img src="logo.png" alt="Acme logo">
      <img src="s.gif" alt=""><img src="p.jpg" alt="Trail Runner Shoe"><p>Order total $50.00</p>`;
    expect(htmlToText(html)).toBe("Trail Runner Shoe\nOrder total $50.00");
  });

  it("keeps link text, drops long URLs, decodes entities and strips invisible characters", () => {
    const html = `<p><a href="https://shop.example/track?id=1234567890abcdef">Track package</a> https://shop.example/very/long/tracking/url?x=1234567890 Tom&nbsp;&amp;&nbsp;Jerry &euro;5 &#36;6&zwnj;&#8203;</p>`;
    expect(htmlToText(html)).toBe("Track package Tom & Jerry €5 $6");
  });

  it("removes copyright/receiving-this footer lines but keeps unsubscribe lines the classifier uses", () => {
    const html = "<p>Order total $9.00</p><p>&copy; 2026 Acme</p><p>You are receiving this email because you ordered.</p><p>Unsubscribe</p>";
    expect(htmlToText(html)).toBe("Order total $9.00\nUnsubscribe");
  });

  it("handles malformed HTML (unclosed tags, stray closers, trailing '<') without throwing", () => {
    expect(htmlToText("<table><tr><td>A<td>B<tr><td>C<td>D</table></div><p>x < y <b")).toBe("A | B\nC | D\nx < y");
  });

  it("caps the output size", () => {
    const html = Array.from({ length: 5000 }, (_, i) => `<p>Line ${i} with some filler text to grow the body</p>`).join("");
    const text = htmlToText(html);
    expect(text.length).toBeLessThanOrEqual(MAX_HTML_TEXT_CHARS);
    expect(text.endsWith("body")).toBe(true);
  });
});

describe("selectBodyText", () => {
  const longPlain = `${"Thanks for your order. ".repeat(12)}Order total: $40.00`;

  it("uses whichever part exists", () => {
    expect(selectBodyText({ plain: "Hello", html: "" })).toEqual({ text: "Hello", bodySource: "plain" });
    expect(selectBodyText({ plain: " ", html: "<p>Hello</p>" })).toEqual({ text: "Hello", bodySource: "html" });
    expect(selectBodyText({ plain: "", html: "" })).toEqual({ text: "", bodySource: null });
  });

  it("keeps a substantial plain part when the HTML has no more prices", () => {
    expect(selectBodyText({ plain: longPlain, html: `<p>${longPlain}</p><p>Extra marketing words</p>` }).bodySource).toBe("plain");
  });

  it("prefers HTML when it has more price tokens than the plain part", () => {
    const html = "<table><tr><td>Mug</td><td>$8.00</td></tr><tr><td>Total</td><td>$8.00</td></tr></table>";
    expect(selectBodyText({ plain: `${"Thanks for your order. ".repeat(12)}Total in the table.`, html })).toEqual({
      text: "Mug | $8.00\nTotal | $8.00",
      bodySource: "html",
    });
  });

  it("prefers HTML when the plain part is thin and the HTML is clearly longer", () => {
    const html = "<p>Your order has shipped with UPS. Tracking number 1Z999AA10123456784, arriving Thursday October 9.</p>";
    expect(selectBodyText({ plain: "Order shipped.", html }).bodySource).toBe("html");
  });

  it("prefers HTML over a short 'view in your browser' plain part", () => {
    const html = "<p>Your order has shipped with UPS. Tracking number 1Z999AA10123456784, arriving Thursday October 9.</p>";
    for (const plain of ["View this email in your browser", "Having trouble viewing this email? View it in a browser.", "To view this message in a web browser: https://x.example/v/1"]) {
      expect(selectBodyText({ plain, html }).bodySource).toBe("html");
    }
  });

  it("keeps a thin plain part when the HTML is not clearly richer", () => {
    expect(selectBodyText({ plain: "Plain receipt", html: "<p>HTML alternative</p>" }).bodySource).toBe("plain");
  });
});

describe.each(HTML_RECEIPT_FIXTURES)("HTML receipt fixture: $name", (fixture) => {
  const checkText = (text: string) => {
    for (const line of fixture.mustContain) expect(text, `contains "${line}"`).toContain(line);
    for (const leak of fixture.mustNotContain) expect(text, `does not contain "${leak}"`).not.toContain(leak);
  };

  it("is decoded from a Gmail message with the expected body source", () => {
    const { email, bodySource } = decodeGmailMessageDetailed(gmailMessage(fixture));
    expect(bodySource).toBe(fixture.expectedSource);
    checkText(email.text);
  });

  it("is decoded from an .eml upload identically", () => {
    const parsed = parseEmlDetailed(emlSource(fixture));
    expect(parsed.bodySource).toBe(fixture.expectedSource);
    expect(parsed.email.text).toBe(decodeGmailMessageDetailed(gmailMessage(fixture)).email.text);
  });

  it("still redacts phone numbers, street addresses and card numbers in the final text", () => {
    const email: RawEmail = decodeGmailMessageDetailed(gmailMessage(fixture)).email;
    const redacted = redact(email);
    expect(redacted.text).not.toContain("(555) 010-");
    expect(redacted.text).not.toContain("412 Alder Street");
  });
});

describe("HTML receipt fixtures: line structure", () => {
  it("keeps label/value pairs and item rows of the first fixture on single lines", () => {
    const fixture = HTML_RECEIPT_FIXTURES[0];
    const lines = decodeGmailMessageDetailed(gmailMessage(fixture)).email.text.split("\n");
    expect(lines).toContain("Subtotal | $125.00");
    expect(lines).toContain("Order total | $134.45");
    expect(lines).toContain("Merino Trail Socks (3-pack), Size L | Qty 2 | $36.00");
    expect(lines.findIndex((line) => line === "Subtotal | $125.00")).toBeLessThan(lines.findIndex((line) => line === "Order total | $134.45"));
  });
});
