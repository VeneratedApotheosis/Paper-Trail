import { describe, expect, it } from "vitest";
import type { RawEmail } from "@/lib/contracts";
import { hashRedactedText, redact } from "./redact";
import { prepareForLlm, redactionMode } from "./prepare";

const EMAIL: RawEmail = {
  id: "m1",
  from: '"Northwind" <orders@northwind.example>',
  to: '"Sam Rivera" <sam.rivera@mail.example>',
  subject: "Order NW-1 for Sam Rivera",
  date: "2026-10-01T10:00:00.000Z",
  text: "Thanks Sam Rivera. Card 4242 4242 4242 4242. Call (555) 012-3456. Tracking 1Z999AA10123456784. Total $40.00",
  html: "<p>secret html</p>",
};

describe("redactionMode", () => {
  it("defaults to off and accepts on/off in any case", () => {
    expect(redactionMode({})).toBe("off");
    expect(redactionMode({ PAPERTRAIL_REDACT: "" })).toBe("off");
    expect(redactionMode({ PAPERTRAIL_REDACT: "nonsense" })).toBe("off");
    expect(redactionMode({ PAPERTRAIL_REDACT: " ON " })).toBe("on");
    expect(redactionMode({ PAPERTRAIL_REDACT: "off" })).toBe("off");
  });

  it("reads PAPERTRAIL_REDACT from the environment when no mode is passed", () => {
    const previous = process.env.PAPERTRAIL_REDACT;
    try {
      process.env.PAPERTRAIL_REDACT = "on";
      expect(prepareForLlm(EMAIL).redactions.pan).toBe(1);
      process.env.PAPERTRAIL_REDACT = "off";
      expect(prepareForLlm(EMAIL).text).toBe(EMAIL.text);
    } finally {
      if (previous === undefined) delete process.env.PAPERTRAIL_REDACT;
      else process.env.PAPERTRAIL_REDACT = previous;
    }
  });
});

describe("prepareForLlm", () => {
  it("off: text and subject unchanged, zero counts, html dropped, hash of the unredacted text", () => {
    const prepared = prepareForLlm(EMAIL, "off");
    expect(prepared.text).toBe(EMAIL.text);
    expect(prepared.subject).toBe(EMAIL.subject);
    expect(prepared.redactions).toEqual({ pan: 0, phone: 0, address: 0, email: 0, name: 0 });
    expect(prepared).not.toHaveProperty("html");
    expect(prepared.textHash).toBe(hashRedactedText(EMAIL.text));
    expect(prepared.id).toBe("m1");
    expect(prepared.to).toBe(EMAIL.to);
  });

  it("on: exactly today's redact()", () => {
    expect(prepareForLlm(EMAIL, "on")).toEqual(redact(EMAIL));
    expect(prepareForLlm(EMAIL, "on").text).not.toContain("4242 4242 4242 4242");
  });

  it("the two modes cache under different hashes", () => {
    expect(prepareForLlm(EMAIL, "on").textHash).not.toBe(prepareForLlm(EMAIL, "off").textHash);
  });

  it("is idempotent on already-prepared text in either mode (stored text is re-prepared before it reaches Claude)", () => {
    for (const mode of ["on", "off"] as const) {
      const once = prepareForLlm(EMAIL, mode);
      const twice = prepareForLlm(once, mode);
      expect(twice.text).toBe(once.text);
      expect(twice.textHash).toBe(once.textHash);
    }
  });
});
