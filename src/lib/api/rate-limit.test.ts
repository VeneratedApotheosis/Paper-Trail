import { afterEach, expect, it, vi } from "vitest";
import { withStoreScope } from "@/lib/store";
import { LIVE_LLM_LIMIT, LIVE_LLM_WINDOW_MS, liveLlmRateLimited, resetLiveLlmLimits, takeLiveLlmCall } from "./rate-limit";

afterEach(() => { resetLiveLlmLimits(); vi.unstubAllEnvs(); });

it("allows LIVE_LLM_LIMIT calls per scope and window, then refuses until the window passes", () => {
  for (let i = 0; i < LIVE_LLM_LIMIT; i += 1) expect(takeLiveLlmCall("anon:a", 1000)).toBe(true);
  expect(takeLiveLlmCall("anon:a", 1000)).toBe(false);
  expect(takeLiveLlmCall("anon:b", 1000)).toBe(true);
  expect(takeLiveLlmCall("anon:a", 1000 + LIVE_LLM_WINDOW_MS)).toBe(true);
});

it("only limits when a live model is configured, per store scope", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  for (let i = 0; i <= LIVE_LLM_LIMIT; i += 1) expect(liveLlmRateLimited()).toBeNull();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-key");
  for (let i = 0; i < LIVE_LLM_LIMIT; i += 1) withStoreScope("anon:x", () => expect(liveLlmRateLimited()).toBeNull());
  const limited = withStoreScope("anon:x", () => liveLlmRateLimited());
  expect(limited?.status).toBe(429);
  expect(withStoreScope("anon:y", () => liveLlmRateLimited())).toBeNull();
});
