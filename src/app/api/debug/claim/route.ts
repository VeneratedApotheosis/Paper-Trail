import { z } from "zod";
import { jsonError } from "@/lib/api/http";
import { clipboardText, draftClaim, mailtoUrl, rephraseDraft, type RephraseAuditEntry } from "@/lib/claims";
import { FindingSchema, NormalizedOrderSchema } from "@/lib/contracts";
import { AnthropicLlmClient } from "@/lib/llm";
import type { PipelineAuditEvent } from "@/lib/pipeline/run";
import { appendAudit } from "@/lib/store";
import { readSchemaBody } from "../_lib/body";
import { debugDisabledResponse, llmConfigured } from "../_lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Finding + order come from GET /api/ledger, so this route needs no store lookup. */
const DebugClaimBodySchema = z.object({
  finding: FindingSchema,
  order: NormalizedOrderSchema,
  profileName: z.string().trim().min(1).max(100).optional(),
  supportEmail: z.string().trim().email().max(200).optional(),
  rephrase: z.boolean().optional(),
});

function rephraseAuditEvent(entry: RephraseAuditEntry): PipelineAuditEvent {
  return {
    at: entry.at,
    type: "llm_call",
    model: entry.model,
    detail: `Rephrase claim — finding ${entry.findingId} (${entry.inputTokens} input / ${entry.outputTokens} output tokens)`,
  };
}

/**
 * POST /api/debug/claim: drafts the claim email for one finding (template; optional fact-checked LLM rephrase when
 * `rephrase` is true and ANTHROPIC_API_KEY is set). Returns copy/mailto hand-off text; nothing is ever sent.
 * The playground uses it for Email-lab findings, which are not in the store; ledger findings go through
 * /api/claims/:findingId (#35). Dev-only (issue #34).
 */
export async function POST(request: Request): Promise<Response> {
  const disabled = debugDisabledResponse();
  if (disabled) return disabled;
  const body = await readSchemaBody(request, DebugClaimBodySchema);
  if (!body.ok) return body.response;
  const { finding, order, profileName, supportEmail, rephrase } = body.data;

  const drafted = draftClaim(finding, order, { profileName, supportEmail, now: new Date() });
  if (!drafted.ok) return jsonError(422, drafted.message, { reason: drafted.reason });

  let draft = drafted.draft;
  const audit: PipelineAuditEvent[] = [];
  let rephraseResult: { rephrased: boolean; reason?: string } | null = null;
  if (rephrase) {
    if (!llmConfigured()) {
      rephraseResult = { rephrased: false, reason: "ANTHROPIC_API_KEY is not configured; using the template draft" };
    } else {
      const result = await rephraseDraft(draft, {
        llm: new AnthropicLlmClient(),
        audit: (entry) => {
          const event = rephraseAuditEvent(entry);
          audit.push(event);
          appendAudit(event);
        },
      });
      draft = result.draft;
      rephraseResult = result.rephrased ? { rephrased: true } : { rephrased: false, reason: result.reason };
    }
  }

  return Response.json({
    draft,
    mailto: mailtoUrl(draft),
    clipboard: clipboardText(draft),
    rephrase: rephraseResult,
    audit,
  });
}
