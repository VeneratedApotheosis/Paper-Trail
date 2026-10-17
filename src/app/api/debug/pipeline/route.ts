import { z } from "zod";
import { jsonError, readJsonBody } from "@/lib/api/http";
import { EmailParseError } from "@/lib/demo";
import { appendAudit, getExtractionCache } from "@/lib/store";
import { debugDisabledResponse, llmConfigured } from "../_lib/guard";
import { MAX_RAW_EMAIL_CHARS, runDebugPipeline } from "../_lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DebugPipelineBodySchema = z.object({
  raw: z.string().min(1).max(MAX_RAW_EMAIL_CHARS),
  now: z.string().datetime({ offset: true }).optional(),
  useLlm: z.boolean().optional(),
});

/**
 * POST /api/debug/pipeline: runs one raw email through every pipeline stage and returns each result.
 * Live extraction only runs when `useLlm` is true AND ANTHROPIC_API_KEY is set. Dev-only (issue #34).
 */
export async function POST(request: Request): Promise<Response> {
  const disabled = debugDisabledResponse();
  if (disabled) return disabled;
  const body = await readJsonBody(request, DebugPipelineBodySchema);
  if (!body.ok) return body.response;

  try {
    const result = await runDebugPipeline({
      raw: body.data.raw,
      now: body.data.now ? new Date(body.data.now) : new Date(),
      useLlm: body.data.useLlm ?? false,
      llmConfigured: llmConfigured(),
      cache: getExtractionCache(),
      audit: appendAudit,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof EmailParseError) return jsonError(400, `Could not parse the email: ${error.message}`);
    throw error;
  }
}
