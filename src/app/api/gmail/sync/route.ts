import { z } from "zod";
import { withAccountStore } from "@/lib/gmail/context";
import { gmailErrorResponse, gmailRequest } from "@/lib/gmail/http";
import { GmailError } from "@/lib/gmail/client";
import { syncGmail } from "@/lib/gmail/service";
import { createLlmExtractor } from "@/lib/pipeline/extractors";
import { beginStoreWork, getExcludedMerchants, getExtractionCache, setPipelineResult } from "@/lib/store";
import { buildPipelineRunResponse } from "@/lib/api/ledger";
import { gmailProgress } from "@/lib/gmail/progress";

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
  let progress: ReturnType<typeof gmailProgress.begin> | undefined;
  try {
    const authenticated = gmailRequest(request);
    userId = authenticated.userId;
    if (running.has(userId)) throw new GmailError(409, "sync_already_running");
    running.add(userId);
    acquired = true;
    progress = gmailProgress.begin(userId);
    const now = new Date();
    // Same guard as upload/demo (#93): capture the store before the long await, write in-flight audit rows to that
    // store only, and don't publish results if delete-all (or a demo reset) ran meanwhile.
    const work = beginStoreWork();
    const { result, ...info } = await syncGmail({ ...authenticated.deps, onProgress: progress.update, pipeline: {
      now, audit: work.appendAudit, excludedMerchants: getExcludedMerchants(),
      extractor: createLlmExtractor({ cache: getExtractionCache(), audit: work.appendAudit }),
    } });
    request.signal.throwIfAborted();
    if (!authenticated.active()) throw new GmailError(401, "token_expired");
    if (!work.isCurrent()) {
      progress.fail();
      return Response.json(
        { error: "Your data was deleted while Gmail was syncing; nothing was saved. Start the sync again if you want it." },
        { status: 409, headers },
      );
    }
    setPipelineResult("gmail", now.toISOString(), result);
    progress.complete();
    return Response.json({ ...buildPipelineRunResponse(), ...info }, { headers });
  } catch (error) { progress?.fail(); return gmailErrorResponse(error); }
  finally { if (userId && acquired) running.delete(userId); }
}
export const POST = withAccountStore(handlePOST);
