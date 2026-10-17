import { describe, expect, it } from "vitest";
import { draftClaim } from "./draft";
import { clipboardText, mailtoUrl } from "./mailto";
import { priceDropFixture } from "./test-fixtures";

function decodeMailto(url: string) {
  const [target, query] = url.slice("mailto:".length).split("?");
  const params = new URLSearchParams(query);
  return {
    recipient: decodeURIComponent(target),
    subject: params.get("subject"),
    body: params.get("body"),
    keys: [...params.keys()],
  };
}

describe("mailtoUrl", () => {
  it("round-trips subject and body with reserved characters, unicode and line breaks", () => {
    const draft = {
      recipient: "support@northwind.example",
      subject: "Refund & price match? #NW-1001 = 100% + more",
      body: 'Line one: $80.00 → $65.00\nLine two "quoted" & 2 × Wool Socks?\n\nThanks,\nSam',
    };
    const url = mailtoUrl(draft);

    expect(url.startsWith("mailto:support@northwind.example?subject=")).toBe(true);
    expect(url).not.toMatch(/[ \n"#]/);
    expect(url).toContain("%0D%0A");
    const decoded = decodeMailto(url);
    expect(decoded.keys).toEqual(["subject", "body"]);
    expect(decoded.recipient).toBe(draft.recipient);
    expect(decoded.subject).toBe(draft.subject);
    expect(decoded.body?.replace(/\r\n/g, "\n")).toBe(draft.body);
  });

  it("round-trips a generated claim draft and allows an empty recipient", () => {
    const { finding, order, now } = priceDropFixture();
    const result = draftClaim(finding, order, { now });
    if (!result.ok) throw new Error(result.message);
    const decoded = decodeMailto(mailtoUrl(result.draft));
    expect(decoded.subject).toBe(result.draft.subject);
    expect(decoded.body?.replace(/\r\n/g, "\n")).toBe(result.draft.body);

    expect(mailtoUrl({ ...result.draft, recipient: "" }).startsWith("mailto:?subject=")).toBe(true);
  });
});

describe("clipboardText", () => {
  it("matches the claim sheet's Subject + body shape", () => {
    expect(clipboardText({ subject: "Return request for order NW-1001", body: "Hello,\n\nThanks" })).toBe(
      "Subject: Return request for order NW-1001\n\nHello,\n\nThanks",
    );
  });
});
