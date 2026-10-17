import { LlmUnavailableError, type LlmClient, type LlmToolRequest, type LlmToolResponse } from "./client";

export const FIXTURE_LLM_MODEL = "fixture";

/**
 * Offline LLM client for demo mode and tests: returns canned tool inputs keyed by RedactedEmail.textHash.
 * Usage is reported as zero tokens because no provider is called.
 */
export class FixtureLlmClient implements LlmClient {
  readonly model: string;
  private readonly toolInputsByTextHash: ReadonlyMap<string, unknown>;

  constructor(toolInputsByTextHash: Record<string, unknown>, model: string = FIXTURE_LLM_MODEL) {
    this.toolInputsByTextHash = new Map(Object.entries(toolInputsByTextHash));
    this.model = model;
  }

  async callTool(request: LlmToolRequest): Promise<LlmToolResponse> {
    if (request.textHash === undefined || !this.toolInputsByTextHash.has(request.textHash)) {
      throw new LlmUnavailableError("No fixture extraction for this email");
    }
    return {
      toolInput: this.toolInputsByTextHash.get(request.textHash),
      text: "",
      usage: { inputTokens: 0, outputTokens: 0 },
      model: this.model,
    };
  }
}
