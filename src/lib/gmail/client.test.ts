import { describe, expect, it, vi } from "vitest";
import { createGmailClient, GmailError } from "./client";
import { GMAIL_RECEIPT_QUERY } from "@/lib/ingestion/prefilter";

function setup(fetcher: typeof fetch) {
  const audit = vi.fn(), sleep = vi.fn().mockResolvedValue(undefined), accessToken = vi.fn().mockResolvedValue("synthetic-access");
  return { client: createGmailClient({ fetcher, audit, sleep, accessToken }), audit, sleep, accessToken };
}
describe("read-only Gmail client", () => {
  it("previews only one ID page and labels the count as an estimate", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ messages: [{ id: "a" }], resultSizeEstimate: 540 }));
    const { client, audit } = setup(fetcher);
    expect(await client.preview()).toBe(540);
    const url = new URL(fetcher.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/gmail/v1/users/me/messages");
    expect(url.searchParams.get("q")).toBe(GMAIL_RECEIPT_QUERY);
    expect(url.searchParams.get("maxResults")).toBe("1");
    expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
    expect(JSON.stringify(audit.mock.calls)).not.toContain("synthetic-access");
  });
  it("paginates, deduplicates IDs, and caps at exactly 300", async () => {
    let page = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      const start = page++ * 99;
      return Response.json({ messages: Array.from({ length: 100 }, (_, i) => ({ id: `m${start + i}` })), nextPageToken: `page${page}`, resultSizeEstimate: 600 });
    });
    const { client } = setup(fetcher);
    const result = await client.listIds();
    expect(result.ids).toHaveLength(300);
    expect(new Set(result.ids).size).toBe(300);
    expect(result.capped).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(new URL(fetcher.mock.calls[1][0] as string).searchParams.get("pageToken")).toBe("page1");
  });
  it("rejects looping pagination rather than looping forever", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ messages: [{ id: "m1" }], nextPageToken: "same" }));
    const { client } = setup(fetcher);
    await expect(client.listIds()).rejects.toThrow("invalid_gmail_pagination");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retries rate limits with Retry-After and audits every fetch", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(Response.json({ resultSizeEstimate: 1 }));
    const { client, audit, sleep } = setup(fetcher);
    expect(await client.preview()).toBe(1);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(audit).toHaveBeenCalledTimes(2);
  });
  it("bounds retries and never leaks a provider error body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("synthetic-access private body", { status: 503 }));
    const { client, sleep, audit } = setup(fetcher);
    await expect(client.preview()).rejects.toMatchObject({ status: 502, code: "gmail_unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(3); expect(sleep).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(audit.mock.calls)).not.toContain("private body");
  });
  it("handles quota 403 and stops on permission denial or expired auth", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({}));
    expect(await setup(fetcher).client.preview()).toBe(0);
    fetcher.mockReset().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(setup(fetcher).client.preview()).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockReset().mockResolvedValue(Response.json({ error: { errors: [{ reason: "forbidden" }] } }, { status: 403 }));
    await expect(setup(fetcher).client.preview()).rejects.toMatchObject({ status: 403 });
  });
  it("honors long retry intervals by surfacing a retryable error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "120" } }));
    const { client, sleep } = setup(fetcher);
    await expect(client.preview()).rejects.toBeInstanceOf(GmailError);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
  });
  it("bounds network retries and rejects invalid JSON/schema", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("synthetic network error"));
    await expect(setup(fetcher).client.preview()).rejects.toThrow("gmail_unavailable");
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockReset().mockResolvedValue(new Response("not JSON"));
    await expect(setup(fetcher).client.preview()).rejects.toThrow("invalid_gmail_response");
    fetcher.mockReset().mockResolvedValue(Response.json({ messages: [{ id: "../bad" }] }));
    await expect(setup(fetcher).client.listIds()).rejects.toThrow("invalid_gmail_response");
  });
});
