import type { RawEmail } from "@/lib/contracts";
import { DEFAULT_PROMO_FETCH, GmailError, MAX_PROMO_FETCH, type GmailClient } from "./client";
import { decodeGmailMessageDetailed } from "./decode";

/** Longest the promotions pass of one account may run (#137); it only ever uses what the sync budget has left. */
export const PROMO_BUDGET_MS = 45000;
/** Below this much remaining budget the promotions pass is skipped rather than started. */
export const PROMO_MIN_BUDGET_MS = 3000;
const PROMO_FETCH_CONCURRENCY = 2;

/** `PROMO_FETCH_LIMIT`: Promotions-category emails read per account and sync (default 30; 0 = off; at most 100). */
export function promoFetchLimit(value: string | undefined = process.env.PROMO_FETCH_LIMIT): number {
  if (value === undefined || value.trim() === "") return DEFAULT_PROMO_FETCH;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, MAX_PROMO_FETCH) : DEFAULT_PROMO_FETCH;
}

/** What the promotions pass of one account read. `warning` is a fixed code (never provider text) when it stopped early. */
export interface PromotionsRead {
  /** Decoded Promotions-category emails not already fetched by the receipt pass, newest first. */
  emails: RawEmail[];
  /** Ids the list query returned and the receipt pass had not fetched. */
  listed: number;
  warning?: string;
}

export interface ReadPromotionsOptions {
  client: GmailClient;
  limit: number;
  /** Message ids the receipt pass already fetched; they are not fetched twice. */
  receiptIds: ReadonlySet<string>;
  sourceAccount?: string;
  /** Ends the pass (time budget); a canceled sync is told apart by the caller. */
  signal: AbortSignal;
  /** Waits for Gmail request budget (shared with the receipt pass). */
  acquire: () => Promise<void>;
  onProgress?: (promotions: { fetched: number; total: number | null }) => void;
}

function warningCode(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) return "promotions_timeout";
  if (error instanceof GmailError) return error.status === 401 ? "token_expired" : error.code;
  return "promotions_unavailable";
}

/**
 * The second, separate list query of a sync (#137): the newest `limit` Promotions-category messages, minus ones the
 * receipt pass fetched. Never throws: a Gmail error, a timeout or a decode problem ends the pass with a `warning` and
 * whatever was read so far, so the receipt results are never lost. Messages that vanished or cannot be decoded are
 * left out quietly. Decoded emails are for the Promotions tab only (never the ledger).
 */
export async function readPromotionEmails(options: ReadPromotionsOptions): Promise<PromotionsRead> {
  const { client, signal } = options;
  const read: Array<RawEmail | undefined> = [];
  let ids: string[] = [];
  const emails = () => read.filter((email): email is RawEmail => email !== undefined);
  try {
    options.onProgress?.({ fetched: 0, total: null });
    ids = (await client.listPromotionIds(options.limit)).ids.filter(id => !options.receiptIds.has(id));
    options.onProgress?.({ fetched: 0, total: ids.length });
    let next = 0, done = 0;
    const worker = async () => {
      for (;;) {
        signal.throwIfAborted();
        const index = next++;
        if (index >= ids.length) return;
        await options.acquire();
        try {
          const { email } = decodeGmailMessageDetailed(await client.message(ids[index], "promotions"));
          if (email.id === ids[index]) read[index] = options.sourceAccount ? { ...email, sourceAccount: options.sourceAccount } : email;
        } catch (error) {
          if (error instanceof GmailError && error.status !== 404) throw error;
          // A message that vanished (404) or cannot be decoded is skipped.
        }
        done++;
        options.onProgress?.({ fetched: done, total: ids.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PROMO_FETCH_CONCURRENCY, ids.length) }, worker));
    return { emails: emails(), listed: ids.length };
  } catch (error) {
    return { emails: emails(), listed: ids.length, warning: warningCode(error, signal) };
  }
}
