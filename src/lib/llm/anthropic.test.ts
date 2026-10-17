import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
  AnthropicLlmClient,
  DEFAULT_LLM_MODEL,
} from "./anthropic";
import { LlmHttpError, LlmResponseError, LlmTimeoutError, LlmUnavailableError, type LlmToolRequest } from "./client";

// Never a real key; tests inject fetch and never touch the network.
const FAKE_KEY = "sk-test-not-a-real-key-123";

const REQUEST: LlmToolRequest = {
  system: "system prompt",
  user: "Subject: Order confirmation #NW-1001",
  tool: { name: "record_extraction", description: "test tool", input_schema: { type: "object" } },
  textHash: "hash-1",
};

type FetchCall = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown, calls: FetchCall[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

const TOOL_RESPONSE = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-test-model",
  stop_reason: "tool_use",
  content: [
    { type: "text", text: "Recording." },
    { type: "tool_use", id: "toolu_1", name: "record_extraction", input: { fields: { merchant: "Northwind" } } },
  ],
  usage: { input_tokens: 321, output_tokens: 45 },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("AnthropicLlmClient request", () => {
  it("POSTs to the Messages API with version, key and JSON headers and forces the tool", async () => {
    const calls: FetchCall[] = [];
    const client = new AnthropicLlmClient({ apiKey: FAKE_KEY, model: "claude-x", fetchImpl: fakeFetch(200, TOOL_RESPONSE, calls) });
    await client.callTool(REQUEST);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "x-api-key": FAKE_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "claude-x",
      system: "system prompt",
      messages: [{ role: "user", content: REQUEST.user }],
      tools: [REQUEST.tool],
      tool_choice: { type: "tool", name: "record_extraction" },
    });
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(String(init.body)).not.toContain(FAKE_KEY);
    expect(String(init.body)).not.toContain("hash-1");
  });

  it("uses LLM_MODEL from env, else the default model", () => {
    vi.stubEnv("LLM_MODEL", "claude-from-env");
    expect(new AnthropicLlmClient({ apiKey: FAKE_KEY }).model).toBe("claude-from-env");
    vi.unstubAllEnvs();
    vi.stubEnv("LLM_MODEL", undefined);
    expect(new AnthropicLlmClient({ apiKey: FAKE_KEY }).model).toBe(DEFAULT_LLM_MODEL);
  });

  it("reads ANTHROPIC_API_KEY from env at runtime", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", FAKE_KEY);
    const calls: FetchCall[] = [];
    await new AnthropicLlmClient({ fetchImpl: fakeFetch(200, TOOL_RESPONSE, calls) }).callTool(REQUEST);
    expect(calls[0].init.headers).toMatchObject({ "x-api-key": FAKE_KEY });
  });

  it("never logs the key", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level));
    const client = new AnthropicLlmClient({ apiKey: FAKE_KEY, fetchImpl: fakeFetch(500, { error: { type: "api_error" } }) });
    await expect(client.callTool(REQUEST)).rejects.toThrow();
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(FAKE_KEY);
    }
  });
});

describe("AnthropicLlmClient response", () => {
  it("returns the tool_use input, text, usage and served model", async () => {
    const client = new AnthropicLlmClient({ apiKey: FAKE_KEY, fetchImpl: fakeFetch(200, TOOL_RESPONSE) });
    await expect(client.callTool(REQUEST)).resolves.toEqual({
      toolInput: { fields: { merchant: "Northwind" } },
      text: "Recording.",
      usage: { inputTokens: 321, outputTokens: 45 },
      model: "claude-test-model",
    });
  });

  it("returns toolInput null when the model did not call the tool", async () => {
    const textOnly = { ...TOOL_RESPONSE, content: [{ type: "text", text: "no tool" }] };
    const client = new AnthropicLlmClient({ apiKey: FAKE_KEY, fetchImpl: fakeFetch(200, textOnly) });
    const response = await client.callTool(REQUEST);
    expect(response.toolInput).toBeNull();
    expect(response.text).toBe("no tool");
  });

  it("throws LlmResponseError for a non-Messages body", async () => {
    const client = new AnthropicLlmClient({ apiKey: FAKE_KEY, fetchImpl: fakeFetch(200, "not json") });
    await expect(client.callTool(REQUEST)).rejects.toBeInstanceOf(LlmResponseError);
    const wrongShape = new AnthropicLlmClient({ apiKey: FAKE_KEY, fetchImpl: fakeFetch(200, { hello: 1 }) });
    await expect(wrongShape.callTool(REQUEST)).rejects.toBeInstanceOf(LlmResponseError);
  });
});

describe("AnthropicLlmClient errors", () => {
  it("throws LlmUnavailableError without calling fetch when no key is set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const calls: FetchCall[] = [];
    const client = new AnthropicLlmClient({ fetchImpl: fakeFetch(200, TOOL_RESPONSE, calls) });
    await expect(client.callTool(REQUEST)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(calls).toHaveLength(0);
  });

  it.each([
    [429, "rate_limit_error", true],
    [500, "api_error", true],
    [529, "overloaded_error", true],
    [401, "authentication_error", false],
  ])("types HTTP %i as LlmHttpError (%s)", async (status, errorType, retryable) => {
    const body = { type: "error", error: { type: errorType, message: "details" } };
    const client = new AnthropicLlmClient({ apiKey: FAKE_KEY, fetchImpl: fakeFetch(status, body) });
    const error = await client.callTool(REQUEST).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmHttpError);
    const httpError = error as LlmHttpError;
    expect(httpError.status).toBe(status);
    expect(httpError.errorType).toBe(errorType);
    expect(httpError.retryable).toBe(retryable);
    expect(httpError.message).toContain(String(status));
    expect(httpError.message).not.toContain(FAKE_KEY);
  });

  it("handles an HTTP error with a non-JSON body", async () => {
    const client = new AnthropicLlmClient({ apiKey: FAKE_KEY, fetchImpl: fakeFetch(502, "<html>bad gateway</html>") });
    const error = await client.callTool(REQUEST).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmHttpError);
    expect((error as LlmHttpError).errorType).toBeNull();
  });

  it("aborts and throws LlmTimeoutError when the request exceeds the timeout", async () => {
    const hangingFetch = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const client = new AnthropicLlmClient({ apiKey: FAKE_KEY, fetchImpl: hangingFetch, timeoutMs: 10 });
    await expect(client.callTool(REQUEST)).rejects.toBeInstanceOf(LlmTimeoutError);
  });
});
