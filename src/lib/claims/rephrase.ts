import { z } from "zod";
import type { LlmClient, LlmTool } from "@/lib/llm";
import { claimClosing, type ClaimDraft } from "./draft";

/**
 * Optional LLM wording pass over a template claim draft (issue #32). The model may only rephrase: every fact the
 * template cites must survive verbatim and no new numbers may appear, otherwise the template draft is returned.
 * Only the draft text minus the signature is sent, so neither raw email content nor the customer's name reaches
 * the provider.
 */

export type RephraseAuditEntry = {
  at: string;
  actor: "llm";
  action: "llm_call";
  purpose: "claim_rephrase";
  model: string;
  inputTokens: number;
  outputTokens: number;
  findingId: string;
};

export type RephraseDeps = {
  llm: LlmClient;
  audit?: (entry: RephraseAuditEntry) => void;
  now?: () => Date;
};

export type RephraseResult =
  | { rephrased: true; draft: ClaimDraft }
  | { rephrased: false; draft: ClaimDraft; reason: string };

const MAX_BODY_CHARS = 4000;

export const REPHRASE_TOOL: LlmTool = {
  name: "submit_rephrased_claim",
  description: "Submit the reworded claim email body.",
  input_schema: {
    type: "object",
    properties: { body: { type: "string", description: "The full reworded email body, without a signature." } },
    required: ["body"],
  },
};

const RephraseToolInputSchema = z.object({ body: z.string().trim().min(1).max(MAX_BODY_CHARS) });

const REPHRASE_SYSTEM_PROMPT = [
  "You improve the wording of a customer's claim email to a merchant's support team.",
  "Keep it polite, concise and factual. No threats, no legal claims, no demands beyond the original request.",
  "Copy every amount, date, order reference, item name and quoted policy text exactly as written.",
  "Do not add any new facts, numbers, dates or promises. Do not add a signature or sign-off.",
  "Return the full reworded body with the submit_rephrased_claim tool.",
].join("\n");

const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;

function numbersIn(text: string): Set<string> {
  return new Set(text.match(NUMBER_PATTERN) ?? []);
}

/** Why `candidate` may not replace `original`, or null when every fact is preserved and no number is new. */
export function factCheckRephrase(original: ClaimDraft, candidate: string): string | null {
  const missing = original.facts.filter((fact) => !candidate.includes(fact.value));
  if (missing.length > 0) {
    return `rephrased body changed or dropped: ${missing.map((fact) => fact.label).join(", ")}`;
  }
  const allowed = numbersIn(original.body);
  const added = [...numbersIn(candidate)].filter((number) => !allowed.has(number));
  if (added.length > 0) return `rephrased body introduced new numbers: ${added.join(", ")}`;
  return null;
}

function userPrompt(content: string, draft: ClaimDraft): string {
  const facts = draft.facts.map((fact) => `- ${fact.label}: ${fact.value}`).join("\n");
  return `Facts that must appear exactly as written:\n${facts}\n\nEmail body to reword:\n${content}`;
}

/** Asks `deps.llm` to reword `draft.body`; falls back to `draft` unchanged on any error or failed fact check. */
export async function rephraseDraft(draft: ClaimDraft, deps: RephraseDeps): Promise<RephraseResult> {
  const fallback = (reason: string): RephraseResult => ({ rephrased: false, draft, reason });
  const closing = claimClosing(draft.signedName);
  if (!draft.body.endsWith(closing)) return fallback("draft signature was edited; rephrase skipped");
  const content = draft.body.slice(0, -closing.length);

  let toolInput: unknown;
  try {
    const response = await deps.llm.callTool({
      system: REPHRASE_SYSTEM_PROMPT,
      user: userPrompt(content, draft),
      tool: REPHRASE_TOOL,
      maxTokens: 1024,
    });
    deps.audit?.({
      at: (deps.now ?? (() => new Date()))().toISOString(),
      actor: "llm",
      action: "llm_call",
      purpose: "claim_rephrase",
      model: response.model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      findingId: draft.findingId,
    });
    toolInput = response.toolInput;
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown error";
    return fallback(`LLM rephrase failed (${name}); using the template draft`);
  }

  const parsed = RephraseToolInputSchema.safeParse(toolInput);
  if (!parsed.success) return fallback("LLM rephrase output was invalid; using the template draft");
  const problem = factCheckRephrase(draft, parsed.data.body);
  if (problem) return fallback(`${problem}; using the template draft`);
  return { rephrased: true, draft: { ...draft, body: parsed.data.body + closing } };
}
