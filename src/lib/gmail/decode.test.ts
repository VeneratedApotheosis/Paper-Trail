import { describe, expect, it } from "vitest";
import { decodeGmailMessage, decodeGmailMessageDetailed } from "./decode";

const data = (value: string) => Buffer.from(value).toString("base64url");
export function gmailMessage(id = "m1", text = "Thanks for your order. Order total: $40.00") {
  return { id, threadId: "thread1", internalDate: "1790812800000", labelIds: ["INBOX"], payload: {
    mimeType: "text/plain", headers: [{ name: "From", value: "orders@synthetic.example" }, { name: "Subject", value: "Order confirmation #SY-1001" }],
    body: { data: data(text) },
  } };
}
describe("Gmail MIME decoder", () => {
  it("decodes UTF-8 base64url and uses Gmail internalDate", () => {
    const message = gmailMessage("m1", "Pedido: café 🌧️");
    expect(decodeGmailMessage(message)).toMatchObject({ id: "m1", threadId: "thread1", text: "Pedido: café 🌧️", from: "orders@synthetic.example" });
    expect(decodeGmailMessage(message).date).toBe(new Date(Number(message.internalDate)).toISOString());
  });
  it("prefers nested plain text and ignores attachment content", () => {
    const base = gmailMessage();
    const message = { ...base, payload: { ...base.payload, mimeType: "multipart/mixed", parts: [
      { mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: data("<p>HTML alternative</p>") } },
        { mimeType: "text/plain", body: { data: data("Plain receipt") } }] },
      { mimeType: "text/plain", filename: "private.txt", body: { data: data("ATTACHMENT MUST NOT APPEAR") } },
    ] } };
    expect(decodeGmailMessage(message).text).toBe("Plain receipt");
  });
  it("converts HTML-only mail without script/style and supports charset", () => {
    const base = gmailMessage();
    expect(decodeGmailMessage({ ...base, payload: { ...base.payload, mimeType: "text/html", body: { data: data("<style>secret</style><p>Order &amp; receipt</p><script>bad()</script>") } } }).text).toBe("Order & receipt");
    expect(decodeGmailMessage({ ...base, payload: { ...base.payload, headers: [...base.payload.headers, { name: "Content-Type", value: "text/plain; charset=iso-8859-1" }],
      body: { data: Buffer.from([99, 97, 102, 233]).toString("base64url") } } }).text).toBe("café");
  });
  it("reports the body source and prefers HTML over a thin 'view in browser' plain part", () => {
    const base = gmailMessage();
    const html = "<table><tr><td>Mug</td><td>$8.00</td></tr><tr><td>Order total</td><td>$8.00</td></tr></table>";
    const multipart = (plain: string) => ({ ...base, payload: { ...base.payload, mimeType: "multipart/alternative", parts: [
      { mimeType: "text/plain", body: { data: data(plain) } }, { mimeType: "text/html", body: { data: data(html) } }] } });
    expect(decodeGmailMessageDetailed(multipart("View this email in your browser"))).toMatchObject({ bodySource: "html", email: { text: "Mug | $8.00\nOrder total | $8.00" } });
    expect(decodeGmailMessageDetailed(multipart(`${"Thanks for your order. ".repeat(12)}Order total: $8.00 and a Mug: $8.00`)).bodySource).toBe("plain");
    expect(decodeGmailMessageDetailed(base).bodySource).toBe("plain");
    expect(decodeGmailMessage(multipart("View this email in your browser")).text).toBe("Mug | $8.00\nOrder total | $8.00");
  });  it("falls back to HTML when a plain part is empty", () => {
    const base = gmailMessage();
    expect(decodeGmailMessage({ ...base, payload: { ...base.payload, parts: [
      { mimeType: "text/plain", body: { data: data(" ") } },
      { mimeType: "text/html", body: { data: data("<p>Receipt</p>") } },
    ] } }).text).toBe("Receipt");
  });
  it("reports malformed, attachment-only, oversized and invalid encoded content safely", () => {
    const base = gmailMessage();
    for (const bad of [null, { ...base, internalDate: "bad", payload: { ...base.payload } },
      { ...base, payload: { ...base.payload, filename: "receipt.pdf" } },
      { ...base, payload: { ...base.payload, body: { data: "%not-base64" } } },
      { ...base, payload: { ...base.payload, body: { data: data("x".repeat(1024 * 1024 + 1)) } } }]) {
      expect(() => decodeGmailMessage(bad)).toThrow("unsupported_or_malformed_message");
    }
  });
});
