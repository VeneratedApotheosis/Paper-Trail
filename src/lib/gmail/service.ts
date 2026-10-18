import type { RawEmail } from "@/lib/contracts";
import { createPipelineRun, type PipelineDeps, type PipelineResult, type PipelineRun } from "@/lib/pipeline/run";
import { GMAIL_RECEIPT_QUERY, PREFILTER_WINDOW_DAYS } from "@/lib/ingestion/prefilter";
import {
  createGmailClient, createRequestPacer, GMAIL_FETCH_BURST, GMAIL_FETCH_PER_SECOND, GmailError, MAX_GMAIL_MESSAGES,
  type GmailDeps,
} from "./client";
import { decodeGmailMessageDetailed } from "./decode";
import type { GmailWorkProgress } from "./progress";
import { PROMO_BUDGET_MS, PROMO_MIN_BUDGET_MS, readPromotionEmails, type PromotionsRead } from "./promotions";

export interface GmailSyncOptions extends GmailDeps {
  pipeline: PipelineDeps;
  /** Sleep used when full-message requests exceed the quota budget (see createRequestPacer); tests inject a no-op. */
  pace?: (ms: number) => Promise<void>;
  onProgress?: (progress: GmailWorkProgress) => void;
  /** Server-side injection for tests; never accepted from a browser request. */
  budgetMs?: number;
  /** Linked account id stamped on every decoded email as `RawEmail.sourceAccount` (#114). */
  sourceAccount?: string;
  /**
   * Promotions-category emails to read after the receipt pass (#137); 0 or unset = off. The routes pass
   * `PROMO_FETCH_LIMIT` (see promoFetchLimit()).
   */
  promoFetchLimit?: number;
}
/** Whole-sync time budget in ms; syncing several accounts splits it between them (see syncGmailAccounts). */
export const SYNC_BUDGET_MS = 240000;
export interface GmailSyncResult {
  result: PipelineResult;
  fetched: number;
  capped: boolean;
  parseErrors: Array<{ id: string; reason: string }>;
  /** Decoded messages by the MIME part their text came from (#117 quality report). */
  bodySources?: { plain: number; html: number };
  /** Set when the promotions pass ran (#137): emails for the Promotions tab only, never for the ledger. */
  promotions?: PromotionsRead;
}
export async function previewGmail(deps: GmailDeps) {
  const estimatedMessages = await createGmailClient(deps).preview();
  return { query: GMAIL_RECEIPT_QUERY, estimatedMessages,
    messagesToFetch: Math.min(estimatedMessages, MAX_GMAIL_MESSAGES), countIsEstimate: true,
    windowDays: PREFILTER_WINDOW_DAYS, maxMessages: MAX_GMAIL_MESSAGES };
}

export async function syncGmail(options: GmailSyncOptions): Promise<GmailSyncResult> {
  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? SYNC_BUDGET_MS;
  // Paces only when the request budget is spent; `pace` is the sleep it uses (tests inject a no-op). Shared by both
  // passes: the Gmail quota is per user.
  const acquireFetchBudget = createRequestPacer({
    burst: GMAIL_FETCH_BURST, perSecond: GMAIL_FETCH_PER_SECOND,
    sleep: options.pace ?? (ms => new Promise(resolve => setTimeout(resolve, ms))),
  });
  const { receiptIds, ...receipts } = await syncReceipts(options, budgetMs, acquireFetchBudget);
  const limit = options.promoFetchLimit ?? 0;
  if (limit <= 0) return receipts;
  // Promotions come after the receipts and use only what is left of the budget; they can never fail the receipt sync.
  options.signal?.throwIfAborted();
  const remainingMs = budgetMs - (Date.now() - startedAt);
  if (remainingMs < PROMO_MIN_BUDGET_MS) return { ...receipts, promotions: { emails: [], listed: 0, warning: "promotions_timeout" } };
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(Math.min(PROMO_BUDGET_MS, remainingMs))]);
  options.onProgress?.({ stage: "promotions", fetched: receipts.fetched, total: receipts.fetched, skipped: receipts.parseErrors.length,
    promotions: { fetched: 0, total: null } });
  const promotions = await readPromotionEmails({
    client: createGmailClient({ ...options, signal }), limit, receiptIds: new Set(receiptIds),
    ...(options.sourceAccount ? { sourceAccount: options.sourceAccount } : {}), signal, acquire: acquireFetchBudget,
    onProgress: promotions => options.onProgress?.({ stage: "promotions", fetched: receipts.fetched, total: receipts.fetched,
      skipped: receipts.parseErrors.length, promotions }),
  });
  options.signal?.throwIfAborted();
  return { ...receipts, promotions };
}

async function syncReceipts(options: GmailSyncOptions, budgetMs: number, acquireFetchBudget: () => Promise<void>): Promise<GmailSyncResult & { receiptIds: string[] }> {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new GmailError(504, "sync_timeout");
      // Reject first so an in-flight request's abort cannot mask the timeout.
      reject(error); controller.abort(error);
    }, budgetMs);
  });
  try {
    // The route can never publish a late worker result once this race rejects.
    return await Promise.race([syncWithinBudget({ ...options, signal }, acquireFetchBudget), deadline]);
  } finally {
    clearTimeout(timer);
    // Stop stragglers (other fetch worker, pending LLM calls) when the sync failed, timed out or was canceled.
    controller.abort();
  }
}

type FetchedSlot = { email: RawEmail } | { parseError: string };
const FETCH_CONCURRENCY = 2;

async function syncWithinBudget(options: GmailSyncOptions & { signal: AbortSignal }, acquireFetchBudget: () => Promise<void>): Promise<GmailSyncResult & { receiptIds: string[] }> {
  const { signal } = options;
  const client = createGmailClient(options);
  options.onProgress?.({ stage: "listing", fetched: 0, total: null, skipped: 0 });
  const listed = await client.listIds();
  const total = listed.ids.length;
  let fetched = 0, skipped = 0;
  const report = (stage: "fetching" | "processing") => options.onProgress?.({ stage, fetched, total, skipped });

  // The shared pipeline queues extractor exceptions and continues. A Gmail
  // replacement snapshot must instead be atomic when its provider is down:
  // threshold = one exception. Do not make further provider calls after that.
  // (Calls already in flight when it happens still finish; they cannot be recalled.)
  let extractionFailed = false;
  const pipeline: PipelineDeps = { ...options.pipeline, applyPrefilter: true, sourceLabel: "gmail",
    extractor: async (...args) => {
      signal.throwIfAborted();
      if (extractionFailed) throw new GmailError(503, "extraction_unavailable");
      try {
        const extracted = await options.pipeline.extractor(...args);
        signal.throwIfAborted();
        return extracted;
      }
      catch {
        extractionFailed = true;
        // Neither the provider payload nor arbitrary exception text is exposed.
        throw new GmailError(503, "extraction_unavailable");
      }
    },
  };
  // Created with the first email so a sync that fails before decoding anything leaves no pipeline audit rows.
  let run: PipelineRun | undefined;
  const pipelineRun = () => run ??= createPipelineRun(pipeline, total);
  const failIfExtractionUnavailable = () => { if (extractionFailed) throw new GmailError(503, "extraction_unavailable"); };

  const bodySources = { plain: 0, html: 0 };
  async function fetchOne(id: string): Promise<FetchedSlot> {
    let message: unknown;
    try { message = await client.message(id); }
    catch (error) {
      if (error instanceof GmailError && error.status === 404) return { parseError: "message_unavailable" };
      throw error; // Transient fetch failures must not replace a complete ledger with partial data.
    }
    try {
      const { email: decoded, bodySource } = decodeGmailMessageDetailed(message);
      if (decoded.id !== id) throw new Error("id mismatch");
      bodySources[bodySource] += 1;
      return { email: options.sourceAccount ? { ...decoded, sourceAccount: options.sourceAccount } : decoded };
    } catch {
      return { parseError: "unsupported_or_malformed_message" };
    }
  }

  // Fetches finish in any order; emails enter the pipeline in listing order so results never depend on timing.
  // A worker waits for its email to be accepted, so fetching pauses while all extraction slots are busy.
  const slots: Array<FetchedSlot | undefined> = new Array(total);
  let nextIndex = 0, fed = 0, accepted = 0;
  let feeding: Promise<void> = Promise.resolve();
  const feed = () => feeding = feeding.then(async () => {
    for (let slot = slots[fed]; slot; slot = slots[fed]) {
      fed++;
      if (!("email" in slot)) continue;
      signal.throwIfAborted();
      failIfExtractionUnavailable();
      await pipelineRun().add(slot.email);
      accepted++;
    }
  });
  async function fetchWorker() {
    for (;;) {
      signal.throwIfAborted();
      failIfExtractionUnavailable();
      const index = nextIndex++;
      if (index >= total) return;
      await acquireFetchBudget();
      const slot = await fetchOne(listed.ids[index]);
      slots[index] = slot;
      if ("parseError" in slot) skipped++;
      fetched++; report("fetching");
      await feed();
    }
  }
  report("fetching");
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, total) }, fetchWorker));
  await feeding;

  const parseErrors: GmailSyncResult["parseErrors"] = [];
  listed.ids.forEach((id, index) => {
    const slot = slots[index];
    if (slot && "parseError" in slot) parseErrors.push({ id, reason: slot.parseError });
  });
  if (total > 0 && accepted === 0) throw new GmailError(422, "no_parseable_messages");
  signal.throwIfAborted();
  report("processing");
  const result = await pipelineRun().finish();
  signal.throwIfAborted();
  if (extractionFailed) throw new GmailError(503, "extraction_unavailable");
  for (const error of parseErrors) result.reviewQueue.push({ emailId: error.id, stage: "extract", reason: error.reason });
  result.stats.needsReview = result.reviewQueue.length;
  return { result, fetched: total, capped: listed.capped, parseErrors, bodySources, receiptIds: listed.ids };
}
