import { describe, expect, it } from "vitest";
import { LlmUnavailableError, type LlmToolRequest } from "./client";
import { FixtureLlmClient } from "./fixture";

const REQUEST: LlmToolRequest = {
  system: "system prompt",
  user: "Subject: Order confirmation #NW-1001",
  tool: { name: "record_extraction", description: "test tool", input_schema: { type: "object" } },
  textHash: "hash-1",
};

describe("FixtureLlmClient", () => {
  it("returns the canned tool input for a known textHash with zero usage", async () => {
    const client = new FixtureLlmClient({ "hash-1": { fields: { merchant: "Northwind" } } });
    await expect(client.callTool(REQUEST)).resolves.toEqual({
      toolInput: { fields: { merchant: "Northwind" } },
      text: "",
      usage: { inputTokens: 0, outputTokens: 0 },
      model: "fixture",
    });
  });

  it("throws LlmUnavailableError for an unknown or missing textHash", async () => {
    const client = new FixtureLlmClient({});
    await expect(client.callTool(REQUEST)).rejects.toBeInstanceOf(LlmUnavailableError);
    await expect(client.callTool({ ...REQUEST, textHash: undefined })).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});
