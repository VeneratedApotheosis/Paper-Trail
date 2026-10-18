import { z } from "zod";
import {
  LlmError,
  LlmHttpError,
  LlmResponseError,
  LlmTimeoutError,
  LlmUnavailableError,
  type LlmClient,
  type LlmToolRequest,
  type LlmToolResponse,
} from "./client";

/**
 * Minimal Anthropic Messages API client over `fetch` (issue #7; provider decision on issue #28).
 * The key is read from `ANTHROPIC_API_KEY` at runtime and only ever placed in the `x-api-key` header.
 */

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_LLM_MODEL = "claude-sonnet-5-5";
export const LLM_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 2048;

export type AnthropicClientOptions = {
  /** Defaults to `process.env.ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** Defaults to `process.env.LLM_MODEL`, then DEFAULT_LLM_MODEL. */
  model?: string;
  /** Injected in tests so they never hit the network. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const MessagesResponseSchema = z.object({
  model: z.string(),
  content: z.array(
    z.union([
      z.object({ type: z.literal("tool_use"), name: z.string(), input: z.unknown() }),
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.string() }).passthrough(),
    ]),
  ),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

const ErrorBodySchema = z.object({ error: z.object({ type: z.string() }) });

async function readErrorType(response: Response): Promise<string | null> {
  try {
    const parsed = ErrorBodySchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error.type : null;
  } catch {
    return null;
  }
}

export class AnthropicLlmClient implements LlmClient {
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: AnthropicClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model = options.model ?? process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS;
  }

  /** Sends one user turn and forces a call to `request.tool`; returns that tool_use block's input. */
  async callTool(request: LlmToolRequest): Promise<LlmToolResponse> {
    if (!this.apiKey) {
      throw new LlmUnavailableError("ANTHROPIC_API_KEY is not set; use cached or fixture extractions instead");
    }

    const body = {
      model: this.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
      tools: [request.tool],
      tool_choice: { type: "tool", name: request.tool.name },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let json: unknown;
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(ANTHROPIC_MESSAGES_URL, {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw new LlmTimeoutError(this.timeoutMs);
        throw new LlmError("LLM request failed: network error", { cause: error });
      }

      if (!response.ok) {
        throw new LlmHttpError(response.status, await readErrorType(response));
      }

      try {
        json = await response.json();
      } catch {
        if (controller.signal.aborted) throw new LlmTimeoutError(this.timeoutMs);
        throw new LlmResponseError("LLM response body is not JSON");
      }
    } finally {
      clearTimeout(timer);
    }

    const parsed = MessagesResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new LlmResponseError("LLM response does not match the Messages API shape");
    }

    let toolInput: unknown = null;
    const textParts: string[] = [];
    for (const block of parsed.data.content) {
      if (block.type === "tool_use" && "name" in block && block.name === request.tool.name) {
        toolInput = block.input;
      } else if (block.type === "text" && "text" in block && typeof block.text === "string") {
        textParts.push(block.text);
      }
    }

    return {
      toolInput,
      text: textParts.join(""),
      usage: { inputTokens: parsed.data.usage.input_tokens, outputTokens: parsed.data.usage.output_tokens },
      model: parsed.data.model,
    };
  }
}
