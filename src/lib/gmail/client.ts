import { z } from "zod";
import { GMAIL_RECEIPT_QUERY } from "@/lib/ingestion/prefilter";

// A bounded synchronous batch, below the product's absolute 300-message maximum.
export const MAX_GMAIL_MESSAGES = 50;
const listSchema = z.object({
  messages: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]+$/) })).default([]),
  nextPageToken: z.string().optional(), resultSizeEstimate: z.number().int().nonnegative().default(0),
});
export class GmailError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
export interface GmailDeps {
  accessToken: () => Promise<string>;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  audit: (action: string, meta: Record<string, unknown>) => void;
  signal?: AbortSignal;
}

export function createGmailClient(deps: GmailDeps) {
  const fetcher = deps.fetcher ?? fetch;
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  async function get(path: string, params: URLSearchParams): Promise<unknown> {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages${path}`);
    url.search = params.toString();
    for (let attempt = 0; attempt < 3; attempt++) {
      deps.signal?.throwIfAborted();
      const token = await deps.accessToken();
      deps.audit("gmail.fetch", { endpoint: path ? "messages.get" : "messages.list", attempt: attempt + 1,
        ...(path ? { messageId: path.slice(1) } : { query: GMAIL_RECEIPT_QUERY }) });
      let response: Response;
      try {
        response = await fetcher(url.toString(), { method: "GET", headers: { Authorization: `Bearer ${token}` },
          cache: "no-store", redirect: "error", signal: deps.signal
            ? AbortSignal.any([deps.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
      } catch {
        if (deps.signal?.aborted) throw new GmailError(499, "sync_canceled");
        if (attempt === 2) throw new GmailError(502, "gmail_unavailable");
        await sleep(1000 * 2 ** attempt); continue;
      }
      if (response.ok) {
        try { return await response.json(); } catch { throw new GmailError(502, "invalid_gmail_response"); }
      }
      if (response.status === 401) throw new GmailError(401, "token_expired");
      if (response.status === 404) throw new GmailError(404, "message_unavailable");
      // Google can report quota limits as 403. Inspect only known reason enums;
      // never propagate the provider's body/message into logs or responses.
      let rateLimited = response.status === 429;
      if (response.status === 403) {
        const limited = z.object({ error: z.object({ errors: z.array(z.object({ reason: z.string() })).default([]) }) })
          .safeParse(await response.json().catch(() => null));
        rateLimited = limited.success && limited.data.error.errors.some(e => ["rateLimitExceeded", "userRateLimitExceeded"].includes(e.reason));
      }
      if (!rateLimited && response.status < 500) throw new GmailError(403, "gmail_access_denied");
      if (attempt === 2) throw new GmailError(rateLimited ? 429 : 502, rateLimited ? "gmail_rate_limited" : "gmail_unavailable");
      const retry = response.headers.get("retry-after");
      const seconds = retry ? Number(retry) : NaN;
      const retryDate = retry ? Date.parse(retry) : NaN;
      const delay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
        : Number.isFinite(retryDate) ? Math.max(0, retryDate - Date.now()) : 1000 * 2 ** attempt;
      // Do not violate a long Retry-After by retrying early; let the user retry.
      if (delay > 10000) throw new GmailError(429, "gmail_rate_limited");
      await sleep(delay);
    }
    throw new GmailError(502, "gmail_unavailable");
  }
  async function list(maxResults: number, pageToken?: string) {
    const params = new URLSearchParams({ q: GMAIL_RECEIPT_QUERY, maxResults: String(maxResults), includeSpamTrash: "false" });
    if (pageToken) params.set("pageToken", pageToken);
    const parsed = listSchema.safeParse(await get("", params));
    if (!parsed.success) throw new GmailError(502, "invalid_gmail_response");
    return parsed.data;
  }
  return {
    async preview() { const page = await list(1); return page.resultSizeEstimate; },
    async listIds() {
      const ids = new Set<string>(), pages = new Set<string>();
      let pageToken: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await list(Math.min(100, MAX_GMAIL_MESSAGES - ids.size), pageToken);
        for (const message of result.messages) { if (ids.size < MAX_GMAIL_MESSAGES) ids.add(message.id); }
        if (!result.nextPageToken || ids.size === MAX_GMAIL_MESSAGES) return { ids: [...ids], capped: Boolean(result.nextPageToken) };
        if (pages.has(result.nextPageToken)) throw new GmailError(502, "invalid_gmail_pagination");
        pages.add(result.nextPageToken); pageToken = result.nextPageToken;
      }
      throw new GmailError(502, "gmail_pagination_limit");
    },
    message(id: string) { return get(`/${encodeURIComponent(id)}`, new URLSearchParams({ format: "full" })); },
  };
}
export type GmailClient = ReturnType<typeof createGmailClient>;

// Full-message get = 60 quota units; the per-user limit is 6,000 units/min (~100 gets/min). A bucket of BURST tokens
// refilled at SUSTAINED_PER_SECOND allows at most BURST + 60 * 1.4 = 94 gets in any minute, under that ceiling.
export const GMAIL_FETCH_BURST = 10;
export const GMAIL_FETCH_PER_SECOND = 1.4;
export interface RequestPacerOptions {
  burst: number;
  perSecond: number;
  /** Called only when a request must wait for budget. */
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
}
/**
 * Token bucket by reservation: every call takes one token immediately and waits only for the deficit, so callers
 * (including concurrent ones) are queued fairly and nothing spins. Under budget it never sleeps.
 */
export function createRequestPacer(options: RequestPacerOptions): () => Promise<void> {
  const now = options.now ?? Date.now;
  let tokens = options.burst;
  let last = now();
  return async () => {
    const current = now();
    tokens = Math.min(options.burst, tokens + ((current - last) / 1000) * options.perSecond);
    last = current;
    tokens -= 1;
    if (tokens < 0) await options.sleep(Math.ceil((-tokens / options.perSecond) * 1000));
  };
}
