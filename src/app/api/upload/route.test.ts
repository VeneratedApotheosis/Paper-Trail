import { afterEach, expect, it, vi } from "vitest";
import { resetLiveLlmLimits, LIVE_LLM_LIMIT } from "@/lib/api/rate-limit";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_EMAILS } from "@/lib/demo";
import { resetStore } from "@/lib/store";
import { POST } from "./route";

afterEach(() => { resetStore(); resetLiveLlmLimits(); vi.unstubAllEnvs(); });

function mbox(count: number): string {
  return Array.from({ length: count }, (_, i) => [
    `From shop@example.test Sat Oct 17 10:00:00 2026`,
    `From: Synthetic Shop <shop@example.test>`,
    `To: buyer@example.test`,
    `Subject: Order SYN-${i} confirmed`,
    `Date: Sat, 17 Oct 2026 10:00:00 +0000`,
    `Message-ID: <syn-${i}@example.test>`,
    ``,
    `Synthetic order SYN-${i}. Total $10.00`,
    ``,
  ].join("\n")).join("\n");
}

function upload(text: string): Request {
  const form = new FormData();
  form.append("file", new File([text], "inbox.mbox"));
  return new Request("http://localhost:3000/api/upload", { method: "POST", body: form });
}

it("rejects an upload with more than MAX_UPLOAD_EMAILS emails", async () => {
  const response = await POST(upload(mbox(MAX_UPLOAD_EMAILS + 1)));
  expect(response.status).toBe(413);
  expect((await response.json()).error).toContain(`limit is ${MAX_UPLOAD_EMAILS}`);
});

it("stops reading a chunked body without Content-Length once it passes the byte limit", async () => {
  let pulled = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { pulled += 1; if (pulled > 20) controller.close(); else controller.enqueue(chunk); },
  });
  const request = new Request("http://localhost:3000/api/upload", {
    method: "POST", body, headers: { "content-type": "multipart/form-data; boundary=x" }, duplex: "half",
  } as RequestInit);
  expect(request.headers.get("content-length")).toBeNull();
  expect((await POST(request)).status).toBe(413);
  expect(pulled * chunk.byteLength).toBeLessThan(MAX_UPLOAD_BYTES * 1.1 + 2 * chunk.byteLength);
});

it("rate-limits uploads per store scope only when a live model is configured", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-key");
  for (let i = 0; i < LIVE_LLM_LIMIT; i += 1) expect((await POST(upload(""))).status).not.toBe(429);
  expect((await POST(upload(""))).status).toBe(429);
});
