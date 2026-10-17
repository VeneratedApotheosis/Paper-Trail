import { z } from "zod";
import { withAccountStore } from "@/lib/gmail/context";
import { gmailErrorResponse, gmailRequest } from "@/lib/gmail/http";
import { GmailError } from "@/lib/gmail/client";
import { syncGmail } from "@/lib/gmail/service";
import { createLlmExtractor } from "@/lib/pipeline/extractors";
import { appendAudit, getExcludedMerchants, getExtractionCache, setPipelineResult } from "@/lib/store";
import { buildPipelineRunResponse } from "@/lib/api/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const running = new Set<string>();
async function handlePOST(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Start sync from this app." }, { status: 403, headers });
  }
  const body = z.object({ confirmed: z.literal(true) }).strict().safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Confirm the Gmail preview before starting sync." }, { status: 400, headers });
  let userId: string | undefined;
  let acquired = false;
  try {
    const authenticated = gmailRequest(request);
    userId = authenticated.userId;
    if (running.has(userId)) throw new GmailError(409, "sync_already_running");
    running.add(userId);
    acquired = true;
    const now = new Date();
    const { result, ...info } = await syncGmail({ ...authenticated.deps, pipeline: {
      now, audit: appendAudit, excludedMerchants: getExcludedMerchants(),
      extractor: createLlmExtractor({ cache: getExtractionCache(), audit: appendAudit }),
    } });
    request.signal.throwIfAborted();
    if (!authenticated.active()) throw new GmailError(401, "token_expired");
    setPipelineResult("gmail", now.toISOString(), result);
    return Response.json({ ...buildPipelineRunResponse(), ...info }, { headers });
  } catch (error) { return gmailErrorResponse(error); }
  finally { if (userId && acquired) running.delete(userId); }
}
export const POST = withAccountStore(handlePOST);
