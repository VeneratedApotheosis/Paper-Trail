import { z } from "zod";
import { withAccountStore } from "@/lib/gmail/context";
import { gmailErrorResponse, gmailRequest } from "@/lib/gmail/http";
import { GmailError } from "@/lib/gmail/client";
import { syncGmailAccounts } from "@/lib/gmail/accounts";
import { createLlmExtractor } from "@/lib/pipeline/extractors";
import { createSyncCollector, type SyncCollector } from "@/lib/quality/collector";
import { classOverridesFor } from "@/lib/quality/labels";
import { promotionTextsOf } from "@/lib/promotions/gmail";
import { recordSyncPromotions } from "@/lib/promotions/state";
import { recordSyncQuality } from "@/lib/quality/state";
import { beginStoreWork, currentStoreScope, getExcludedMerchants, getExtractionCache, setAccountPipelineResult } from "@/lib/store";
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
  // `accountId` limits the sync to one linked account; by default every account is synced one after another (#114).
  const body = z.object({ confirmed: z.literal(true), accountId: z.string().min(1).optional() }).strict()
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Confirm the Gmail preview before starting sync." }, { status: 400, headers });
  let userId: string | undefined;
  let acquired = false;
  let progress: ReturnType<typeof gmailProgress.begin> | undefined;
  try {
    const authenticated = gmailRequest(request, body.data.accountId);
    userId = authenticated.userId;
    if (running.has(userId)) throw new GmailError(409, "sync_already_running");
    running.add(userId);
    acquired = true;
    const run = gmailProgress.begin(userId);
    progress = run;
    const now = new Date();
    // Same guard as upload/demo (#93): capture the store before the long await, write in-flight audit rows to that
    // store only, and don't publish results if delete-all (or a demo reset) ran meanwhile.
    const work = beginStoreWork();
    const collectors = new Map<string, SyncCollector>();
    const classOverride = classOverridesFor(currentStoreScope());
    const synced = await syncGmailAccounts({
      accounts: authenticated.accounts, signal: request.signal,
      // Per-account progress only when several accounts are synced; one account keeps the plain status shape.
      reporter: account => authenticated.accounts.length > 1 ? run.forAccount(account.id, account.mailbox)
        : { update: run.update, complete: () => undefined, fail: () => undefined },
      pipeline: account => {
        const collector = createSyncCollector({ source: "gmail", accountId: account.id });
        collectors.set(account.id, collector);
        return { now, audit: work.appendAudit, excludedMerchants: getExcludedMerchants(), observer: collector.observe, classOverride,
          extractor: createLlmExtractor({ cache: getExtractionCache(), audit: work.appendAudit, onUsage: collector.recordUsage }) };
      },
      publish: (accountId, result, accountSync) => {
        if (!work.isCurrent()) return false;
        setAccountPipelineResult(accountId, now.toISOString(), result, new Date().toISOString());
        const collector = collectors.get(accountId);
        if (collector) {
          const promotions = accountSync.promotions;
          const collected = collector.finish(result, { fetched: accountSync.fetched, bodySource: accountSync.bodySources,
            ...(promotions ? { promotionsFetched: promotions.emails.length } : {}) });
          recordSyncQuality(collected);
          // Promotions-category emails (#137) reach the Promotions tab only, never the quality skipped list or the ledger.
          const withPromotions = promotions ? { ...collected, texts: [...collected.texts, ...promotionTextsOf(promotions.emails)] } : collected;
          // Claude reads promotion details in the background (PROMO_LLM_LIMIT). A failed promotions pass keeps the earlier ones.
          void recordSyncPromotions(withPromotions, { retainPrevious: promotions?.warning !== undefined }).enrichment;
        }
        return true;
      },
    });
    run.complete();
    return Response.json({ ...buildPipelineRunResponse(), ...synced }, { headers });
  } catch (error) {
    progress?.fail();
    if (error instanceof GmailError && error.code === "data_deleted") {
      return Response.json(
        { error: "Your data was deleted while Gmail was syncing; nothing was saved. Start the sync again if you want it." },
        { status: 409, headers },
      );
    }
    return gmailErrorResponse(error);
  }
  finally { if (userId && acquired) running.delete(userId); }
}
export const POST = withAccountStore(handlePOST, { requireToken: true });