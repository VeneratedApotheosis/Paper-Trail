import { withAccountStore } from "@/lib/gmail/context";
import { buildPipelineRunResponse } from "@/lib/api/ledger";
import { jsonError } from "@/lib/api/http";
import type { PipelineRunResponse, ResetDemoResponse } from "@/lib/api/types";
import { loadSeedDemo } from "@/lib/demo";
import { appendAudit, clearLedger, getExcludedMerchants, getState, setPipelineResult } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Loads the synthetic seed inbox through the shared pipeline (offline). */
async function handlePOST(_request: Request): Promise<Response> {
  void _request;
  const result = await loadSeedDemo({ audit: appendAudit, excludedMerchants: getExcludedMerchants() });
  setPipelineResult("demo", result.asOf, result);
  const body: PipelineRunResponse = buildPipelineRunResponse();
  return Response.json(body);
}

/** Clears demo data from the ledger (audit log kept). Refuses to clear non-demo data. */
async function handleDELETE(_request: Request): Promise<Response> {
  void _request;
  const { mode } = getState();
  if (mode !== "demo" && mode !== "empty") {
    return jsonError(409, `Current data comes from ${mode}, not demo mode; use POST /api/delete-all instead`);
  }
  if (mode === "demo") {
    clearLedger();
    appendAudit({ at: new Date().toISOString(), type: "delete", detail: "Demo data cleared from the ledger" });
  }
  const body: ResetDemoResponse = { mode: getState().mode };
  return Response.json(body);
}

export const POST = withAccountStore(handlePOST);

export const DELETE = withAccountStore(handleDELETE);
