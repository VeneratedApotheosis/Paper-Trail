import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmClient, LlmToolResponse } from "@/lib/llm";
import { clipboardText, draftClaim, mailtoUrl, rephraseDraft } from "./index";
import {
  priceDropFixture,
  refundOverdueFixture,
  refundShortFixture,
  returnDeadlineFixture,
} from "./test-fixtures";

const CLAIMS_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Library sources only: tests and fixtures may import node:fs etc. */
const sourceFiles = readdirSync(CLAIMS_DIR).filter(
  (file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "test-fixtures.ts",
);

const FORBIDDEN_PATTERNS: [string, RegExp][] = [
  ["fetch", /\bfetch\s*\(/],
  ["XMLHttpRequest", /XMLHttpRequest/],
  ["WebSocket", /WebSocket/],
  ["sendBeacon", /sendBeacon/],
  ["node networking", /from\s+["'](?:node:)?(?:http|https|net|tls|dgram|child_process)["']/],
  ["mail transport", /nodemailer|smtp|sendmail|gmail\.send|messages\.send/i],
  ["concrete LLM client", /AnthropicLlmClient|FixtureLlmClient/],
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("src/lib/claims never sends", () => {
  it("has library sources to check", () => {
    expect(sourceFiles.sort()).toEqual(["draft.ts", "index.ts", "mailto.ts", "rephrase.ts"]);
  });

  it.each(sourceFiles)("%s has no network, mail transport or concrete LLM client", (file) => {
    const source = readFileSync(join(CLAIMS_DIR, file), "utf8");
    for (const [label, pattern] of FORBIDDEN_PATTERNS) {
      expect(pattern.test(source), `${file} matches ${label}`).toBe(false);
    }
    // The only LLM dependency is the injected client's type.
    for (const match of source.matchAll(/^import .* from "@\/lib\/llm";$/gm)) {
      expect(match[0].startsWith("import type ")).toBe(true);
    }
  });

  it("drafts, rephrases and builds hand-off text without touching global fetch", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network is not allowed in claims");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const llm: LlmClient = {
      model: "fake",
      callTool: vi.fn(
        async (): Promise<LlmToolResponse> => ({
          toolInput: { body: "unrelated" },
          text: "",
          usage: { inputTokens: 1, outputTokens: 1 },
          model: "fake",
        }),
      ),
    };

    for (const { finding, order, now } of [
      refundOverdueFixture(),
      refundShortFixture(),
      returnDeadlineFixture(),
      priceDropFixture(),
    ]) {
      const result = draftClaim(finding, order, { now });
      if (!result.ok) throw new Error(result.message);
      const rephrased = await rephraseDraft(result.draft, { llm });
      mailtoUrl(rephrased.draft);
      clipboardText(rephrased.draft);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(llm.callTool).toHaveBeenCalledTimes(4);
  });
});
