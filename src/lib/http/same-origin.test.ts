import { describe, expect, it } from "vitest";
import { sameOriginAllowed } from "./same-origin";

const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/gmail/sync", { method: "POST", headers });

describe("sameOriginAllowed", () => {
  it("accepts same-origin, no-origin and a tunnel origin that matches the forwarded host", () => {
    expect(sameOriginAllowed(req({ origin: "http://localhost:3000" }))).toBe(true);
    expect(sameOriginAllowed(req({}))).toBe(true);
    expect(sameOriginAllowed(req({ origin: "https://x.ngrok-free.dev", "x-forwarded-host": "x.ngrok-free.dev", "x-forwarded-proto": "https" }))).toBe(true);
  });
  it("rejects a foreign origin and cross-site fetches", () => {
    expect(sameOriginAllowed(req({ origin: "https://evil.example", host: "localhost:3000" }))).toBe(false);
    expect(sameOriginAllowed(req({ "sec-fetch-site": "cross-site" }))).toBe(false);
  });
});
