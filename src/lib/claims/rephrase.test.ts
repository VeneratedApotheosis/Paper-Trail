import { describe, expect, it } from "vitest";
import {
  LlmTimeoutError,
  LlmHttpError,
  LlmError,
  LlmUnavailableError,
  type LlmClient,
  type LlmToolRequest,
  type LlmToolResponse,
} from "@/lib/llm";
import { draftClaim, type ClaimDraft } from "./draft";
import { REPHRASE_TOOL, rephraseDraft, type RephraseAuditEntry } from "./rephrase";
import { refundOverdueFixture } from "./test-fixtures";

const REWORDED_CONTENT = [
  "Hello Northwind Outfitters support team,",
  "I placed order NW-1001 on Sep 1, 2026, and your team received my return on Sep 20, 2026.",
  "I was expecting a refund of $113.00 by Sep 30, 2026, but it has not arrived yet.",
  'Your policy states: "Refunds are issued within 10 days of receiving your return."',
  "Could you please look into the status of this refund and let me know when it will be processed?",
].join("\n\n");

class FakeLlm implements LlmClient {
  readonly model = "fake-model";
  readonly requests: LlmToolRequest[] = [];

  constructor(private readonly respond: (request: LlmToolRequest) => unknown) {}

  async callTool(request: LlmToolRequest): Promise<LlmToolResponse> {
    this.requests.push(request);
    return { toolInput: this.respond(request), text: "", usage: { inputTokens: 120, outputTokens: 80 }, model: this.model };
  }
}

function templateDraft(): ClaimDraft {
  const { finding, order, now } = refundOverdueFixture();
  const result = draftClaim(finding, order, { now });
  if (!result.ok) throw new Error(result.message);
  return result.draft;
}

describe("rephraseDraft", () => {
  it("accepts a rewording that keeps every fact verbatim and re-attaches the signature", async () => {
    const draft = templateDraft();
    const llm = new FakeLlm(() => ({ body: REWORDED_CONTENT }));
    const audit: RephraseAuditEntry[] = [];
    const result = await rephraseDraft(draft, {
      llm,
      audit: (entry) => audit.push(entry),
      now: () => new Date("2026-10-05T12:00:00.000Z"),
    });

    expect(result.rephrased).toBe(true);
    expect(result.draft.body).toBe(`${REWORDED_CONTENT}\n\nThank you,\nSam Synthetic`);
    expect({ ...result.draft, body: draft.body }).toEqual(draft);
    expect(audit).toEqual([
      {
        at: "2026-10-05T12:00:00.000Z",
        actor: "llm",
        action: "llm_call",
        purpose: "claim_rephrase",
        model: "fake-model",
        inputTokens: 120,
        outputTokens: 80,
        findingId: "refund_overdue:ord-1",
        outcome: "success",
      },
    ]);
  });

  it("sends only the draft text, without the signature name or recipient, and forces the rephrase tool", async () => {
    const draft = templateDraft();
    const llm = new FakeLlm(() => ({ body: REWORDED_CONTENT }));
    await rephraseDraft(draft, { llm });

    expect(llm.requests).toHaveLength(1);
    const [request] = llm.requests;
    expect(request.tool).toBe(REPHRASE_TOOL);
    expect(request.user).toContain("I expected a refund of $113.00 by Sep 30, 2026");
    expect(request.user).not.toContain("Sam Synthetic");
    expect(request.user).not.toContain(draft.recipient);
    expect(request.system).not.toContain("Sam Synthetic");
  });

  it("rejects a rewording that changes an amount", async () => {
    const draft = templateDraft();
    const llm = new FakeLlm(() => ({ body: REWORDED_CONTENT.replace("$113.00", "$131.00") }));
    const result = await rephraseDraft(draft, { llm });

    expect(result).toEqual({
      rephrased: false,
      draft,
      reason: "rephrased body changed or dropped: Expected refund; using the template draft",
    });
  });

  it("rejects a rewording that introduces a number the template did not cite", async () => {
    const draft = templateDraft();
    const llm = new FakeLlm(() => ({ body: `${REWORDED_CONTENT}\n\nI have waited 15 days.` }));
    const result = await rephraseDraft(draft, { llm });

    expect(result.rephrased).toBe(false);
    expect(result.draft).toBe(draft);
    if (!result.rephrased) expect(result.reason).toContain("introduced new numbers: 15");
  });

  it.each([
    ["timeout", new LlmTimeoutError(30_000), "timeout"],
    ["missing key", new LlmUnavailableError("ANTHROPIC_API_KEY is not set"), "unavailable"],
    ["http", new LlmHttpError(503, "synthetic-private"), "http_error"],
    ["network", new LlmError("synthetic-private"), "network_error"],
  ])("falls back to the template on LLM error (%s)", async (_label, error, name) => {
    const draft = templateDraft();
    const llm = new FakeLlm(() => {
      throw error;
    });
    const audit: RephraseAuditEntry[] = [];
    const result = await rephraseDraft(draft, { llm, audit: (entry) => audit.push(entry) });

    expect(result).toEqual({
      rephrased: false,
      draft,
      reason: `LLM rephrase failed (${name}); using the template draft`,
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ outcome: "error", errorClass: name, inputTokens: 0, outputTokens: 0 });
    expect(JSON.stringify(audit)).not.toContain("synthetic-private");
  });

  it("falls back when the tool output is not a valid body", async () => {
    const draft = templateDraft();
    const result = await rephraseDraft(draft, { llm: new FakeLlm(() => ({ text: "hi" })) });
    expect(result).toMatchObject({ rephrased: false, draft, reason: expect.stringContaining("invalid") });
  });

  it("skips the LLM when the user edited the signature", async () => {
    const draft = templateDraft();
    const llm = new FakeLlm(() => ({ body: REWORDED_CONTENT }));
    const edited = { ...draft, body: draft.body.replace("Thank you,\nSam Synthetic", "Best,\nSam") };
    const result = await rephraseDraft(edited, { llm });

    expect(result).toMatchObject({ rephrased: false, draft: edited });
    expect(llm.requests).toEqual([]);
  });
});
