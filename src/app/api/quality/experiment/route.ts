import { z } from "zod";
import { jsonError } from "@/lib/api/http";
import { withAccountStore } from "@/lib/gmail/context";
import { PROMPT_VARIANT_IDS, runExperiment, type PromptVariantId } from "@/lib/quality/experiment";
import { QualityError } from "@/lib/quality/feedback";
import { qualityErrorResponse, qualityOriginAllowed } from "@/lib/quality/http";
import { scorableLabels } from "@/lib/quality/labels";
import { beginStoreWork, currentStoreScope, getExtractionCache } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.object({
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/).optional(),
  promptVariant: z.enum(PROMPT_VARIANT_IDS as [PromptVariantId, ...PromptVariantId[]]).optional(),
}).strict();

const running = new Set<string>();

/**
 * POST /api/quality/experiment `{ model?, promptVariant? }`: runs the labeled set (at most 50 labels) through that model
 * and prompt and compares accuracy and estimated cost with the current setting. CALLS CLAUDE; does not change the
 * live setting. Audited.
 */
async function handlePOST(request: Request): Promise<Response> {
  if (!qualityOriginAllowed(request)) return jsonError(403, "Run experiments from this app.");
  const text = await request.text();
  let json: unknown;
  try { json = text.trim() === "" ? {} : JSON.parse(text); } catch { return jsonError(400, "Request body must be valid JSON"); }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return jsonError(400, "Invalid request body", parsed.error.flatten());
  const scope = currentStoreScope();
  if (running.has(scope)) return jsonError(409, "An experiment is already running.");
  running.add(scope);
  try {
    const labels = scorableLabels(scope);
    const work = beginStoreWork();
    const at = new Date();
    work.appendAudit({ at: at.toISOString(), type: "approval",
      detail: `Quality experiment started: model ${parsed.data.model ?? "current"}, prompt ${parsed.data.promptVariant ?? "default"}; calls Claude with redacted text` });
    const result = await runExperiment(labels, parsed.data, { cache: getExtractionCache(), audit: work.appendAudit });
    return Response.json(result);
  } catch (error) {
    return error instanceof QualityError ? qualityErrorResponse(error) : jsonError(500, "The experiment could not be completed.");
  } finally {
    running.delete(scope);
  }
}

export const POST = withAccountStore(handlePOST);
