import { withAccountStore } from "@/lib/gmail/context";
import { runRealEval } from "@/lib/eval/real";
import { currentModelName } from "@/lib/quality/experiment";
import { scorableLabels } from "@/lib/quality/labels";
import { currentStoreScope, getExtractionCache } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/quality/eval: scores the receipt gate and field extraction against the saved labels. Cache only: it never
 * calls a model (labels with no cached extraction are listed as unscored; use the experiment to run a model).
 */
async function handleGET(_request: Request): Promise<Response> {
  void _request;
  const labels = scorableLabels(currentStoreScope());
  const report = await runRealEval(labels, { cache: getExtractionCache() });
  return Response.json({ ...report, model: currentModelName() }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withAccountStore(handleGET);
