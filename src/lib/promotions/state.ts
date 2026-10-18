import type { Promotion } from "@/lib/contracts";
import { classify } from "@/lib/ingestion";
import { AnthropicLlmClient, type LlmClient } from "@/lib/llm";
import type { CollectedSync } from "@/lib/quality/collector";
import { redactedEmailOf } from "@/lib/quality/text";
import type { StoredEmailText } from "@/lib/quality/types";
import { beginStoreWork, getPromotionData, getState, type StoreWork } from "@/lib/store";
import { applyPromotionDetails, readPromotionWithClaude } from "./llm";
import { collapsePromotions } from "./merge";
import { hasOffer, promotionFrom, readPromotion, type PromotionEmail, type RulesOptions } from "./rules";
import type { PromotionDetails, PromotionEntry } from "./types";

export const MAX_PROMOTIONS = 300;
export const DEFAULT_PROMO_LLM_LIMIT = 20;
const ENRICH_CONCURRENCY = 3;
const USER_SET = "set by the user";
const PHISHING_REASON = /phishing|suspicious/i;

/** `PROMO_LLM_LIMIT`: how many promotions per sync may be sent to Claude (default 20; 0 = rules only). */
export function promotionLlmLimit(value: string | undefined = process.env.PROMO_LLM_LIMIT): number {
  if (value === undefined || value.trim() === "") return DEFAULT_PROMO_LLM_LIMIT;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_PROMO_LLM_LIMIT;
}

function emailOf(stored: StoredEmailText): PromotionEmail & { accountId?: string } {
  return {
    emailId: stored.emailId, ...(stored.accountId ? { accountId: stored.accountId } : {}),
    fromName: stored.fromName, fromDomain: stored.fromDomain, subject: stored.subject, date: stored.date, text: stored.text,
  };
}

/**
 * Which marketing emails of a run become promotions. Receipts and shipping updates never do (an extracted email with a
 * promo footer stays a receipt). Classified marketing needs an offer (a discount, a code or an end date); mail the
 * classifier would not call marketing (a Chinese promo, or one the prefilter dropped) needs a discount plus a code or an
 * end date. A person's "this is a promotion" always counts.
 */
export function promotionCandidates(texts: readonly StoredEmailText[], rules: RulesOptions = {}): Array<{ stored: StoredEmailText; promotion: Promotion }> {
  const candidates: Array<{ stored: StoredEmailText; promotion: Promotion }> = [];
  for (const stored of texts) {
    if (stored.outcome !== "skipped" && stored.outcome !== "prefiltered") continue;
    if (Number.isNaN(Date.parse(stored.date))) continue;
    const verdict = stored.classification ?? classify(redactedEmailOf(stored));
    if (PHISHING_REASON.test(verdict.reason ?? "")) continue;
    const reading = readPromotion(emailOf(stored), rules);
    const userSet = verdict.class === "marketing" && verdict.reason === USER_SET;
    const strong = reading.discount !== null && (reading.codes.length > 0 || reading.expiresAt !== null);
    const included = userSet || (verdict.class === "marketing" ? hasOffer(reading) : verdict.class === "not_receipt" && strong);
    if (included) candidates.push({ stored, promotion: promotionFrom(emailOf(stored), reading, "rules") });
  }
  return candidates;
}

export interface RecordPromotionsOptions {
  /** Ask Claude for details (default true). Demo data is offline by design and passes false. */
  useClaude?: boolean;
  /** Defaults to the Anthropic client (needs ANTHROPIC_API_KEY, otherwise only the rules' reading is kept). Tests inject a fake. */
  llm?: LlmClient;
  /** Most provider calls for this run (default `PROMO_LLM_LIMIT`, 20). Cached answers are free and not counted. */
  limit?: number;
  now?: () => Date;
  rules?: RulesOptions;
  /**
   * Keep the account's earlier promotions and add this run's (default: replace them). A Gmail sync whose promotions
   * pass failed sets it, so a Gmail hiccup does not empty the Promotions tab (#137).
   */
  retainPrevious?: boolean;
}

export interface RecordedPromotions {
  /** Promotions found by rules in this run (before duplicates are collapsed). */
  recorded: number;
  /** Resolves when Claude's pass is over (immediately when there is nothing to ask); never rejects. */
  enrichment: Promise<void>;
}

function setEntry(entries: Map<string, PromotionEntry>, stored: StoredEmailText, promotion: Promotion, cache: Map<string, PromotionDetails>): void {
  const details = cache.get(stored.textHash);
  entries.set(stored.emailId, details
    ? { promotion: applyPromotionDetails(promotion, details), stored, attempted: true }
    : { promotion, stored, attempted: false });
}

/**
 * Records the promotions of one published run (call right after recordSyncQuality): a Gmail run replaces that
 * account's promotions, an upload or demo run replaces all of them. Rules read every candidate at once; then, in the
 * background, Claude reads the newest `limit` that no cached answer covers (see enrichPromotions).
 */
export function recordSyncPromotions(collected: CollectedSync, options: RecordPromotionsOptions = {}): RecordedPromotions {
  const data = getPromotionData();
  const { accountId, source } = collected.report;
  for (const [emailId, entry] of data.entries) {
    if (options.retainPrevious !== true && (source !== "gmail" || entry.stored.accountId === accountId)) data.entries.delete(emailId);
  }
  const candidates = promotionCandidates(collected.texts, options.rules)
    .sort((a, b) => Date.parse(b.promotion.receivedAt) - Date.parse(a.promotion.receivedAt))
    .slice(0, MAX_PROMOTIONS);
  for (const { stored, promotion } of candidates) setEntry(data.entries, stored, promotion, data.detailsCache);
  const enrichment = options.useClaude === false ? Promise.resolve() : enrichPromotions(options);
  return { recorded: candidates.length, enrichment };
}

/** One person-marked promotion ("This is a promotion"): read by rules whatever they found, Claude's cached answer applied. */
export function addPromotionFromEmail(stored: StoredEmailText, rules: RulesOptions = {}): Promotion {
  const data = getPromotionData();
  const promotion = promotionFrom(emailOf(stored), readPromotion(emailOf(stored), rules), "rules");
  setEntry(data.entries, stored, promotion, data.detailsCache);
  return data.entries.get(stored.emailId)!.promotion;
}

/** The email is no longer a promotion (a person said it is a receipt or a shipping update). */
export function forgetPromotion(emailId: string): void {
  getPromotionData().entries.delete(emailId);
}

async function inPool<T>(items: readonly T[], size: number, task: (item: T) => Promise<boolean>): Promise<void> {
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < items.length) {
      const item = items[next++];
      if (!(await task(item))) stopped = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

function auditDetail(emailId: string, entry: { inputTokens: number; outputTokens: number; outcome?: string; errorClass?: string }): string {
  const usage = entry.outcome === "error" ? `failed: ${entry.errorClass}` : `${entry.inputTokens} input / ${entry.outputTokens} output tokens`;
  return `Read promotion details — email ${emailId} (${usage})`;
}

/**
 * Sends the newest `limit` not-yet-asked promotions to Claude, three at a time. Every provider request writes an audit
 * row (model, tokens, never text). Invalid answers are retried once, then the rules' reading stays; a provider error
 * keeps the rules' reading too; a missing key ends the pass quietly. Stops when the data was deleted meanwhile.
 */
export async function enrichPromotions(options: RecordPromotionsOptions = {}): Promise<void> {
  const limit = options.limit ?? promotionLlmLimit();
  const data = getPromotionData();
  const pending = [...data.entries.values()]
    .filter((entry) => !entry.attempted)
    .sort((a, b) => Date.parse(b.promotion.receivedAt) - Date.parse(a.promotion.receivedAt))
    .slice(0, limit);
  if (pending.length === 0) return;
  for (const entry of pending) entry.attempted = true; // claimed now, so a second sync finishing meanwhile never asks twice
  const work: StoreWork = beginStoreWork();
  const llm = options.llm ?? new AnthropicLlmClient();
  data.enriching += 1;
  try {
    await inPool(pending, ENRICH_CONCURRENCY, async (entry) => {
      if (!work.isCurrent() || data.entries.get(entry.stored.emailId) !== entry) return true;
      const { stored } = entry;
      const outcome = await readPromotionWithClaude(stored.emailId, stored, stored.textHash, {
        llm, now: options.now, rules: options.rules,
        audit: (row) => work.appendAudit({
          at: row.at, type: "llm_call", model: row.model,
          redactedTokenCount: Object.values(stored.redactions).reduce((sum, count) => sum + count, 0),
          detail: auditDetail(stored.emailId, row),
        }),
      });
      if (outcome.kind === "unavailable") return false;
      if (outcome.kind === "details") {
        data.detailsCache.set(stored.textHash, outcome.details);
        if (work.isCurrent() && data.entries.get(stored.emailId) === entry) entry.promotion = applyPromotionDetails(entry.promotion, outcome.details);
      }
      return true;
    });
  } catch {
    // Claude's pass is best effort: the rules' reading is already listed.
  } finally {
    data.enriching -= 1;
  }
}

export interface PromotionsResponse {
  promotions: Promotion[];
  /** Number of promotions returned. */
  total: number;
  /** The clock expiry was judged against: the demo's fixed as-of in demo mode, else now. */
  asOf: string;
  /** Expired promotions left out (0 with `include=expired`). */
  expiredHidden: number;
  /** Claude is still reading details; fetch again shortly. */
  enriching: boolean;
}

const isExpired = (promotion: Promotion, now: number) => promotion.expiresAt !== null && Date.parse(promotion.expiresAt) <= now;

/**
 * The promotions of the current store scope: duplicates collapsed, active ones first by expiry (soonest first, no
 * expiry last, newest email first within a tie), expired ones (only with `includeExpired`) after them, latest expiry first.
 */
export function listPromotions(options: { includeExpired?: boolean; now?: Date } = {}): PromotionsResponse {
  const data = getPromotionData();
  const state = getState();
  const asOf = options.now ?? (state.mode === "demo" && state.asOf ? new Date(state.asOf) : new Date());
  const clock = asOf.getTime();
  const all = collapsePromotions([...data.entries.values()].map((entry) => entry.promotion));
  const expiredCount = all.filter((promotion) => isExpired(promotion, clock)).length;
  const active = all.filter((promotion) => !isExpired(promotion, clock)).sort((a, b) => {
    const left = a.expiresAt === null ? Infinity : Date.parse(a.expiresAt);
    const right = b.expiresAt === null ? Infinity : Date.parse(b.expiresAt);
    return left === right ? Date.parse(b.receivedAt) - Date.parse(a.receivedAt) : left < right ? -1 : 1;
  });
  const expired = options.includeExpired
    ? all.filter((promotion) => isExpired(promotion, clock)).sort((a, b) => Date.parse(b.expiresAt!) - Date.parse(a.expiresAt!))
    : [];
  const promotions = [...active, ...expired];
  return {
    promotions, total: promotions.length, asOf: asOf.toISOString(),
    expiredHidden: options.includeExpired ? 0 : expiredCount, enriching: data.enriching > 0,
  };
}
