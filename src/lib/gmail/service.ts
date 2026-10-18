import type { RawEmail } from "@/lib/contracts";
import { runPipeline, type PipelineDeps, type PipelineResult } from "@/lib/pipeline/run";
import { GMAIL_RECEIPT_QUERY, PREFILTER_WINDOW_DAYS } from "@/lib/ingestion/prefilter";
import { createGmailClient, GmailError, MAX_GMAIL_MESSAGES, type GmailDeps } from "./client";
import { decodeGmailMessage } from "./decode";
import type { GmailWorkProgress } from "./progress";

export interface GmailSyncOptions extends GmailDeps {
  pipeline: PipelineDeps;
  /** Production paces full-message requests conservatively; tests inject no-op sleep. */
  pace?: (ms: number) => Promise<void>;
  onProgress?: (progress: GmailWorkProgress) => void;
  /** Server-side injection for tests; never accepted from a browser request. */
  budgetMs?: number;
}
export interface GmailSyncResult {
  result: PipelineResult;
  fetched: number;
  capped: boolean;
  parseErrors: Array<{ id: string; reason: string }>;
}
export async function previewGmail(deps: GmailDeps) {
  const estimatedMessages = await createGmailClient(deps).preview();
  return { query: GMAIL_RECEIPT_QUERY, estimatedMessages,
    messagesToFetch: Math.min(estimatedMessages, MAX_GMAIL_MESSAGES), countIsEstimate: true,
    windowDays: PREFILTER_WINDOW_DAYS, maxMessages: MAX_GMAIL_MESSAGES };
}

export async function syncGmail(options: GmailSyncOptions): Promise<GmailSyncResult> {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new GmailError(504, "sync_timeout");
      // Reject first so an in-flight request's abort cannot mask the timeout.
      reject(error); controller.abort(error);
    }, options.budgetMs ?? 240000);
  });
  try {
    // The route can never publish a late worker result once this race rejects.
    return await Promise.race([syncWithinBudget({ ...options, signal }), deadline]);
  } finally { clearTimeout(timer); }
}

async function syncWithinBudget(options: GmailSyncOptions): Promise<GmailSyncResult> {
  const client = createGmailClient(options);
  options.onProgress?.({ stage: "listing", fetched: 0, total: null, skipped: 0 });
  const listed = await client.listIds();
  const emails: RawEmail[] = [];
  const parseErrors: GmailSyncResult["parseErrors"] = [];
  const pace = options.pace ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let fetched = 0;
  const report = (stage: "fetching" | "processing") => options.onProgress?.({
    stage, fetched, total: listed.ids.length, skipped: parseErrors.length,
  });
  report("fetching");
  for (const id of listed.ids) {
    options.signal?.throwIfAborted();
    let message: unknown;
    try { message = await client.message(id); }
    catch (error) {
      if (error instanceof GmailError && error.status === 404) {
        parseErrors.push({ id, reason: "message_unavailable" });
        fetched++; report("fetching"); await pace(650); continue;
      }
      throw error; // Transient fetch failures must not replace a complete ledger with partial data.
    }
    try {
      const decoded = decodeGmailMessage(message);
      if (decoded.id !== id) throw new Error("id mismatch");
      emails.push(decoded);
    } catch {
      parseErrors.push({ id, reason: "unsupported_or_malformed_message" });
    }
    fetched++; report("fetching");
    await pace(650);
  }
  if (listed.ids.length > 0 && emails.length === 0) throw new GmailError(422, "no_parseable_messages");
  options.signal?.throwIfAborted();
  report("processing");
  // The shared pipeline queues extractor exceptions and continues. A Gmail
  // replacement snapshot must instead be atomic when its provider is down:
  // threshold = one exception. Do not make further provider calls after that.
  let extractionFailed = false;
  const result = await runPipeline(emails, { ...options.pipeline, applyPrefilter: true, sourceLabel: "gmail",
    extractor: async (...args) => {
      options.signal?.throwIfAborted();
      if (extractionFailed) throw new GmailError(503, "extraction_unavailable");
      try {
        const extracted = await options.pipeline.extractor(...args);
        options.signal?.throwIfAborted();
        return extracted;
      }
      catch {
        extractionFailed = true;
        // Neither the provider payload nor arbitrary exception text is exposed.
        throw new GmailError(503, "extraction_unavailable");
      }
    },
  });
  options.signal?.throwIfAborted();
  if (extractionFailed) throw new GmailError(503, "extraction_unavailable");
  for (const error of parseErrors) result.reviewQueue.push({ emailId: error.id, stage: "extract", reason: error.reason });
  result.stats.needsReview = result.reviewQueue.length;
  return { result, fetched: listed.ids.length, capped: listed.capped, parseErrors };
}
