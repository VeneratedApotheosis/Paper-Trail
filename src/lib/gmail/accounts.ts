import { AuthError } from "@/lib/auth/google";
import type { PipelineDeps, PipelineResult } from "@/lib/pipeline/run";
import { GmailError, type GmailDeps } from "./client";
import type { GmailWorkProgress } from "./progress";
import { previewGmail, syncGmail, SYNC_BUDGET_MS, type GmailSyncResult } from "./service";

/** One linked Gmail account of the signed-in profile as the preview/sync routes see it (#114). */
export interface GmailAccountTarget {
  id: string;
  mailbox: string | null;
  /** A locally valid grant exists; false = reconnect before this account can be read. */
  connected: boolean;
  /** Re-checked right before publishing: false when the grant was cleared (disconnect, delete-all) mid-sync. */
  active(): boolean;
  deps: GmailDeps;
}

/** Why one account could not be read: `token_expired` or the Gmail/sync error code (never provider text). */
export type GmailAccountFailure = { accountId: string; mailbox: string | null; ok: false; code: string };

export type GmailAccountPreview =
  | { accountId: string; mailbox: string | null; ok: true; estimatedMessages: number; messagesToFetch: number }
  | GmailAccountFailure;

export type GmailAccountSync =
  | { accountId: string; mailbox: string | null; ok: true; fetched: number; capped: boolean }
  | GmailAccountFailure;

function failureCode(error: unknown): string {
  if (error instanceof AuthError) return error.reason;
  if (error instanceof GmailError) return error.status === 401 ? "token_expired" : error.code;
  return "sync_unavailable";
}

/**
 * Previews every given account. The totals add up the accounts that answered; accounts that could not (expired grant,
 * Gmail error) are listed with their `code` so the UI can offer a reconnect. Throws the first error only when no
 * account answered, so a single-account request fails exactly like before.
 */
export async function previewGmailAccounts(accounts: readonly GmailAccountTarget[]) {
  const results: GmailAccountPreview[] = [];
  let first: Awaited<ReturnType<typeof previewGmail>> | undefined;
  let firstError: unknown;
  let estimatedMessages = 0, messagesToFetch = 0;
  for (const account of accounts) {
    const base = { accountId: account.id, mailbox: account.mailbox };
    if (!account.connected) {
      firstError ??= new AuthError("token_expired");
      results.push({ ...base, ok: false, code: "token_expired" });
      continue;
    }
    try {
      const preview = await previewGmail(account.deps);
      first ??= preview;
      estimatedMessages += preview.estimatedMessages;
      messagesToFetch += preview.messagesToFetch;
      results.push({ ...base, ok: true, estimatedMessages: preview.estimatedMessages, messagesToFetch: preview.messagesToFetch });
    } catch (error) {
      if (account.deps.signal?.aborted) throw error;
      firstError ??= error;
      results.push({ ...base, ok: false, code: failureCode(error) });
    }
  }
  if (!first) throw firstError ?? new AuthError("token_expired");
  return { ...first, estimatedMessages, messagesToFetch, accounts: results };
}

/** What the routes pass in: the pipeline deps for one account, how to publish its result, how to report progress. */
export interface SyncAccountsOptions {
  accounts: readonly GmailAccountTarget[];
  signal: AbortSignal;
  /** Fresh pipeline deps for each account (extractor, audit, exclusions). */
  pipeline: (account: GmailAccountTarget) => PipelineDeps;
  /** Reporter per account; the route wires it to gmailProgress. */
  reporter: (account: GmailAccountTarget) => {
    update: (progress: GmailWorkProgress) => void;
    complete: () => void;
    fail: () => void;
  };
  /**
   * Commits one account's finished sync. Returns false when the store was reset meanwhile (delete-all, demo reset):
   * the whole sync stops with `data_deleted` and nothing further is published.
   */
  publish: (accountId: string, result: PipelineResult, synced: GmailSyncResult) => boolean;
  /** Total budget across accounts; defaults to SYNC_BUDGET_MS. Server-side/test injection only. */
  totalBudgetMs?: number;
}

export interface SyncAccountsResult {
  fetched: number;
  capped: boolean;
  parseErrors: Array<GmailSyncResult["parseErrors"][number] & { accountId: string }>;
  accounts: GmailAccountSync[];
}

/**
 * Syncs the given accounts one after another, each publishing its own result as soon as it finishes. The total time
 * budget is shared: every account gets an equal share of what is left, so a quick account leaves time for the next
 * and the whole request stays under the route's maxDuration. One account failing (expired grant, rate limit,
 * timeout) does not stop the others; it is reported with its `code` and its previous results stay untouched. The
 * first error is thrown only when no account succeeded, so a single-account sync fails exactly like before.
 */
export async function syncGmailAccounts(options: SyncAccountsOptions): Promise<SyncAccountsResult> {
  const startedAt = Date.now();
  const total = options.totalBudgetMs ?? SYNC_BUDGET_MS;
  const outcomes: GmailAccountSync[] = [];
  const parseErrors: SyncAccountsResult["parseErrors"] = [];
  let fetched = 0, capped = false, firstError: unknown;
  // Every account is registered up front so progress shows the ones still waiting for their turn.
  const reporters = options.accounts.map(account => options.reporter(account));
  for (const [index, account] of options.accounts.entries()) {
    const base = { accountId: account.id, mailbox: account.mailbox };
    const report = reporters[index];
    try {
      if (!account.connected) throw new AuthError("token_expired");
      const budgetMs = Math.max(1, Math.floor((total - (Date.now() - startedAt)) / (options.accounts.length - index)));
      const synced = await syncGmail({ ...account.deps, sourceAccount: account.id, budgetMs, onProgress: report.update,
        pipeline: options.pipeline(account) });
      options.signal.throwIfAborted();
      if (!account.active()) throw new GmailError(401, "token_expired");
      if (!options.publish(account.id, synced.result, synced)) {
        report.fail();
        throw new GmailError(409, "data_deleted");
      }
      report.complete();
      fetched += synced.fetched;
      capped ||= synced.capped;
      parseErrors.push(...synced.parseErrors.map(error => ({ ...error, accountId: account.id })));
      outcomes.push({ ...base, ok: true, fetched: synced.fetched, capped: synced.capped });
    } catch (error) {
      report.fail();
      // A canceled request or a reset store ends the whole sync; anything else only fails this account.
      if (options.signal.aborted || (error instanceof GmailError && error.code === "data_deleted")) throw error;
      firstError ??= error;
      outcomes.push({ ...base, ok: false, code: failureCode(error) });
    }
  }
  if (!outcomes.some(outcome => outcome.ok)) throw firstError ?? new AuthError("token_expired");
  return { fetched, capped, parseErrors, accounts: outcomes };
}
