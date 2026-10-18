import { describe, expect, it } from "vitest";
import { AnthropicLlmClient } from "./anthropic";

const ok = { id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "tool_use", id: "t", name: "tool", input: { a: 1 } }], usage: { input_tokens: 1, output_tokens: 1 } };
const tool = { name: "tool", description: "d", input_schema: { type: "object" as const, properties: {} } };

describe("AnthropicLlmClient tool_choice fallback", () => {
  it("retries with tool_choice auto when the model rejects a forced tool, and remembers it", async () => {
    const choices: string[] = [];
    const fetchImpl = (async (_url: unknown, init: { body: string }) => {
      const choice = JSON.parse(init.body).tool_choice.type as string;
      choices.push(choice);
      return choice === "tool"
        ? new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }), { status: 400 })
        : new Response(JSON.stringify(ok), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new AnthropicLlmClient({ apiKey: "k", fetchImpl });
    expect((await client.callTool({ system: "s", user: "u", tool })).toolInput).toEqual({ a: 1 });
    await client.callTool({ system: "s", user: "u", tool });
    expect(choices).toEqual(["tool", "auto", "auto"]);
  });
});
