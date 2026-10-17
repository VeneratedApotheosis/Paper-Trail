/**
 * Provider-agnostic LLM client contract (issue #7). Extraction depends on this interface only, so tests and
 * demo mode can swap in a fake or the FixtureLlmClient without a key or network.
 */

/** A tool the model is forced to call; its `input_schema` is a JSON Schema object. */
export type LlmTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type LlmToolRequest = {
  system: string;
  /** Single user turn. Must contain redacted email content only (AGENTS.md hard rule #3). */
  user: string;
  tool: LlmTool;
  maxTokens?: number;
  /** RedactedEmail.textHash; lets FixtureLlmClient answer offline. Never sent to the provider. */
  textHash?: string;
};

export type LlmUsage = { inputTokens: number; outputTokens: number };

export type LlmToolResponse = {
  /** Input of the forced tool_use block; null when the model did not call the tool. */
  toolInput: unknown;
  /** Concatenated text blocks (usually empty when the tool call is forced). */
  text: string;
  usage: LlmUsage;
  /** Model that actually served the request. */
  model: string;
};

export interface LlmClient {
  readonly model: string;
  callTool(request: LlmToolRequest): Promise<LlmToolResponse>;
}

/** Base class for LLM failures. Messages never include the API key or email text. */
export class LlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmError";
  }
}

/** No API key configured, or no canned fixture for this input. */
export class LlmUnavailableError extends LlmError {
  constructor(message: string) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

/** Provider returned a non-2xx status (429 rate limit, 5xx, 401, ...). */
export class LlmHttpError extends LlmError {
  readonly status: number;
  /** Provider error type, e.g. `rate_limit_error`, when the body has one. */
  readonly errorType: string | null;

  constructor(status: number, errorType: string | null) {
    super(`LLM request failed with HTTP ${status}${errorType ? ` (${errorType})` : ""}`);
    this.name = "LlmHttpError";
    this.status = status;
    this.errorType = errorType;
  }

  /** 429 and 5xx are worth retrying with backoff; other statuses are not. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export class LlmTimeoutError extends LlmError {
  constructor(timeoutMs: number) {
    super(`LLM request timed out after ${timeoutMs} ms`);
    this.name = "LlmTimeoutError";
  }
}

/** Provider returned 2xx with a body that is not a Messages API response. */
export class LlmResponseError extends LlmError {
  constructor(message: string) {
    super(message);
    this.name = "LlmResponseError";
  }
}
