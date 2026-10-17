import { draftClaim, rephraseDraft, type ClaimDraft, type ClaimFact, type DraftClaimOptions } from "@/lib/claims";
import type { Finding, NormalizedOrder } from "@/lib/contracts";
import { AnthropicLlmClient } from "@/lib/llm";
import { appendAudit, getFinding, getOrder, getState } from "@/lib/store";
import type { Draft } from "@/lib/types";
import { jsonError } from "./http";
import type { ClaimDraftRecord } from "./types";

/** Server-side helpers for the /api/claims routes (issue #35). Nothing here sends email (AGENTS.md rule 2). */

export const EDITED_FACTS_WARNING_PREFIX = "Edited body no longer contains: ";

export type ClaimContext = { finding: Finding; order: NormalizedOrder };

/** Visible finding + order (excluded merchants and deleted data are not found). */
export function getClaimContext(findingId: string): ClaimContext | undefined {
  const finding = getFinding(findingId);
  const order = finding ? getOrder(finding.orderId) : undefined;
  return finding && order ? { finding, order } : undefined;
}

function isClaimDraftRecord(draft: Draft): draft is ClaimDraftRecord {
  return "facts" in draft && "warnings" in draft && "edited" in draft;
}

/** Stored claim draft for a visible finding. */
export function getStoredClaimDraft(findingId: string): ClaimDraftRecord | undefined {
  const draft = getState().drafts.find((candidate) => candidate.findingId === findingId);
  return draft && isClaimDraftRecord(draft) ? draft : undefined;
}

export type GeneratedClaimDraft = { ok: true; draft: ClaimDraftRecord } | { ok: false; response: Response };

/**
 * Builds the template draft. Deadline warnings use the ledger's rule clock (`asOf`, the seed date in demo mode),
 * the same clock the findings were computed with. draftClaim failures (e.g. rewards_gap) become a 422.
 */
export function generateClaimDraft(
  { finding, order }: ClaimContext,
  options: Omit<DraftClaimOptions, "now"> = {},
): GeneratedClaimDraft {
  const asOf = getState().asOf;
  const result = draftClaim(finding, order, { ...options, now: asOf ? new Date(asOf) : new Date() });
  if (!result.ok) return { ok: false, response: jsonError(422, result.message, { reason: result.reason }) };
  return { ok: true, draft: { ...result.draft, edited: false, rephrased: false } };
}

export type ClaimRephraseOutcome = { draft: ClaimDraftRecord; rephrased: boolean; reason?: string };

/** Optional LLM wording pass; falls back to the template without a key. The key is never logged or returned. */
export async function maybeRephraseClaim(draft: ClaimDraftRecord, rephrase: boolean): Promise<ClaimRephraseOutcome> {
  if (!rephrase) return { draft, rephrased: false, reason: "Rephrase not requested; using the template draft" };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { draft, rephrased: false, reason: "ANTHROPIC_API_KEY is not set; using the template draft" };
  }
  const result = await rephraseDraft(draft, {
    llm: new AnthropicLlmClient(),
    audit: (entry) =>
      appendAudit({
        at: entry.at,
        type: "llm_call",
        model: entry.model,
        detail: `Claim rephrase for finding ${entry.findingId}: ${entry.inputTokens} input / ${entry.outputTokens} output tokens`,
      }),
  });
  if (!result.rephrased) return { draft, rephrased: false, reason: result.reason };
  return { draft: { ...draft, body: result.draft.body, rephrased: true }, rephrased: true };
}

function describeFact(fact: ClaimFact): string {
  return `${fact.label} (${fact.value})`;
}

/**
 * Applies user edits. Keeps the template facts and warnings; warns when a cited fact is no longer in the body,
 * since the user may have changed a number. Clears any earlier approval: the edited text was not approved.
 */
export function applyClaimEdits(
  draft: ClaimDraftRecord,
  edits: Pick<ClaimDraft, "subject" | "body" | "recipient">,
): ClaimDraftRecord {
  const missing = draft.facts.filter((fact) => !edits.body.includes(fact.value));
  const warnings = draft.warnings.filter((warning) => !warning.startsWith(EDITED_FACTS_WARNING_PREFIX));
  if (missing.length > 0) warnings.push(`${EDITED_FACTS_WARNING_PREFIX}${missing.map(describeFact).join(", ")}`);
  const edited: ClaimDraftRecord = { ...draft, ...edits, warnings, edited: true };
  delete edited.approvedAt;
  return edited;
}
