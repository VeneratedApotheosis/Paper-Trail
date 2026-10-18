import { withAccountStore } from "@/lib/gmail/context";
import { buildPipelineRunResponse } from "@/lib/api/ledger";
import { jsonError } from "@/lib/api/http";
import type { PipelineRunResponse, ResetDemoResponse } from "@/lib/api/types";
import { DEMO_COOKIE } from "@/middleware";
import { loadSeedDemo } from "@/lib/demo";
import { createSyncCollector } from "@/lib/quality/collector";
import { classOverridesFor } from "@/lib/quality/labels";
import { demoPromotionTexts } from "@/lib/promotions/demo";
import { recordSyncPromotions } from "@/lib/promotions/state";
import { recordSyncQuality } from "@/lib/quality/state";
import { appendAudit, beginStoreWork, clearLedger, currentStoreScope, getExcludedMerchants, getState, setPipelineResult } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Loads the synthetic seed inbox through the shared pipeline (offline). */
async function handlePOST(_request: Request): Promise<Response> {
  void _request;
  // Captured before the await: delete-all or a demo reset during the load must not be undone by this commit.
  const work = beginStoreWork();
  const collector = createSyncCollector({ source: "demo" });
  const result = await loadSeedDemo({
    audit: work.appendAudit, excludedMerchants: getExcludedMerchants(),
    observer: collector.observe, classOverride: classOverridesFor(currentStoreScope()),
  });
  if (!work.isCurrent()) {
    return jsonError(409, "Your data was deleted while the demo was loading; nothing was saved. Load the demo again to continue.");
  }
  setPipelineResult("demo", result.asOf, result);
  const collected = collector.finish(result);
  recordSyncQuality(collected);
  recordSyncPromotions({ ...collected, texts: [...collected.texts, ...demoPromotionTexts()] }, { useClaude: false }); // the demo is offline: rules only
  const body: PipelineRunResponse = buildPipelineRunResponse();
  return Response.json(body);
}

/**
 * Clears demo data from the ledger (audit log kept). Refuses to clear non-demo data. Also clears when the ledger is
 * still empty, so a demo load in flight is cancelled instead of reappearing after the reset.
 */
async function handleDELETE(_request: Request): Promise<Response> {
  void _request;
  const { mode } = getState();
  if (mode !== "demo" && mode !== "empty") {
    return jsonError(409, `Current data comes from ${mode}, not demo mode; use POST /api/delete-all instead`);
  }
  clearLedger();
  if (mode === "demo") {
    appendAudit({ at: new Date().toISOString(), type: "delete", detail: "Demo data cleared from the ledger" });
  }
  const body: ResetDemoResponse = { mode: getState().mode };
  return Response.json(body);
}

/** Mirrors the demo state into a cookie so middleware can route demo visitors into the app (and out on reset). */
function withDemoCookie(handler: (request: Request) => Promise<Response>, loaded: boolean) {
  return async (request: Request): Promise<Response> => {
    const response = await handler(request);
    if (!response.ok) return response;
    const out = new Response(response.body, response);
    const value = loaded ? `${DEMO_COOKIE}=1; Path=/; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax` : `${DEMO_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    out.headers.append("Set-Cookie", value);
    return out;
  };
}

export const POST = withAccountStore(withDemoCookie(handlePOST, true));

export const DELETE = withAccountStore(withDemoCookie(handleDELETE, false));
