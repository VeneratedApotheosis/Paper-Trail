# PaperTrail JSON API (issues #4, #31)

Page-independent backend for the ledger UI. All routes are Next.js route handlers in `src/app/api/**`
(Node runtime, never cached), return JSON only, and answer bad input with a 4xx `{ error, details? }` body.
Response types live in `src/lib/api/types.ts`; data shapes are the canonical contracts from `@/lib/contracts`
(`NormalizedOrder`, `Finding`) and `@/lib/types` (`AuditEntry`, `OwedSummary`).

State is an in-memory session store (`src/lib/store`, kept on `globalThis`); restarting the server empties it.
Raw email bodies are never stored: only orders, findings, drafts, the review queue and the audit log.

| Method + path | Request | Response (200) | Errors |
|---|---|---|---|
| `POST /api/demo` | none | `PipelineRunResponse` `{ mode: "demo", asOf, summary, stats }` | 409 if delete-all / demo reset ran while it was loading (nothing saved) |
| `DELETE /api/demo` | none | `{ mode: "empty" }` (audit log kept) | 409 when the ledger holds non-demo data |
| `GET /api/account` | none | `AccountResponse` (see "Account and Gmail disconnect" below) | 401 invalid / expired session cookie (cookies cleared) |
| `POST /api/auth/disconnect` | optional `{ accountId }` | `DisconnectResponse` `{ disconnected: true, revokedToken }` | 400 bad body, 401 not signed in, 403 cross-site, 404 unknown `accountId` |
| `GET /api/auth/google` | none | redirect to Google consent (signs in / reconnects) | 503 not configured |
| `GET /api/auth/link` | none | same redirect, but the callback adds the mailbox to the signed-in profile (see "Multiple Gmail accounts") | 503 not configured |
| `GET /api/ledger` | none | `LedgerResponse` `{ mode, asOf, orders, findings, summary, reviewQueue, excludedMerchants, stats, labels }` | |
| `GET /api/orders/:id` | id URL-encoded (`encodeURIComponent`) | `{ order, findings }` | 400 empty id, 404 unknown / excluded |
| `GET /api/findings/:id` | id URL-encoded | `{ finding, order }` | 400, 404 |
| `POST /api/findings/:id/status` | `{ status: "resolved" \| "dismissed" \| "open" }` | `FindingStatusResponse` `{ finding, summary }` (summary recomputed) | 400 empty id / invalid JSON / body, 404 unknown / excluded / deleted |
| `POST /api/upload` | `multipart/form-data`, one or more `.eml` / `.mbox` files (any field name), 5 MB total | `UploadResponse` = `PipelineRunResponse` (`mode: "upload"`) + `{ files: [{ name, emails }], parseErrors: [{ file, index, reason }] }` | 400 no files / wrong type / nothing parseable, 413 too large, 409 if delete-all ran while it was processing (nothing saved) |
| `GET /api/prefilter` | none | `{ query, description, windowDays }` (exact Gmail search + plain-language text) | |
| `GET /api/audit` | none | `{ entries: AuditEntry[] }`, newest first | |
| `POST /api/delete-all` | none | `{ deleted: true, ok: true, at, revokedToken, purged: { orders, findings, drafts, reviewItems, audit } }` | |
| `POST /api/merchants/exclude` | `{ merchant: string }` (name or domain, case-insensitive) | `{ excludedMerchants: string[] }` | 400 invalid JSON / body |
| `DELETE /api/merchants/exclude` | `{ merchant: string }` | `{ excludedMerchants: string[] }` | 400 |

Notes:
- `mode` is `"empty" | "demo" | "upload" | "gmail"`. Show `labels.demo` ("Demo data — synthetic") on every page while
  `mode === "demo"`, and `labels.simulatedPrice` on findings with `simulated: true`.
- `labels.precomputedExtraction` is non-null when extractions came from seed gold labels instead of an LLM
  (demo mode without a committed `seed/llm-cache.json`); show it with the demo banner.
- `summary` is `computeOwed(findings, orders)` from `src/lib/rules/owed.ts`, the single source of truth for the owed
  total (`computeOwedSummary` / `findingCountsTowardOwed` in `src/lib/view.ts` delegate to it). See "Owed summary" below.
- `reviewQueue` items are `{ emailId, stage: "classify" | "extract" | "match" | "rules", reason, orderId? }` (`match`: e.g. odd/negative totals or an unreadable email date; `rules`: a rule failed for that one order, which gets no findings while every other order still does): uncertain
  classifications that were not extracted, failed / invalid / low-confidence extractions, and orders that need review.
- Excluded merchants are hidden from every response (ledger, orders, findings, review queue) until re-included.
- Delete-all purges orders, findings, drafts, review queue, extraction cache, exclusions and the audit log, keeping
  one `delete` audit record. OAuth revocation is a hook (`setRevokeOAuthHook` in `src/lib/store`) that #3 registers;
  until then `revokedToken` is `false`.
- Audit `llm_call` entries carry model, `redactedTokenCount` (= number of PII tokens redaction replaced in that email)
  and token counts in `detail`; never email text. Demo-mode gold extractions are logged with `model: "gold"` and
  "Precomputed extraction from seed gold label, no LLM call".
- Uploads use real extraction (`ANTHROPIC_API_KEY`) with a session cache; without a key, cache misses land in the
  review queue instead of failing. Uploads replace the current ledger.

## Account and Gmail disconnect (issue #109)

`GET /api/account` (account-scoped, `Cache-Control: no-store`, never returns tokens) -> `AccountResponse`:

```json
{ "gmail": { "connected": true, "expired": false, "mailbox": "shopper@example.com" },
  "accounts": [{ "id": "…", "mailbox": "shopper@example.com", "connected": true, "expired": false, "lastSyncAt": "2026-10-18T01:02:03.000Z" }],
  "mode": "gmail", "asOf": "...", "lastSyncAt": "2026-10-18T01:02:03.000Z",
  "counts": { "orders": 45, "findings": 6, "reviewItems": 2 }, "excludedMerchants": [], "syncing": false }
```

- Anonymous (no cookie): `gmail: { connected: false, expired: false, mailbox: null }`, `accounts: []` plus the anonymous store's mode / counts.
- `accounts` (#114) lists every Gmail account linked to the profile, the profile's first mailbox first, then linked ones in
  link order; `gmail` mirrors the first connected account (else the first one) so single-account UI keeps working.
- `gmail.connected` = a locally valid refresh grant exists. `gmail.expired` = signed in but the grant is gone (expired,
  revoked, cleared after `invalid_grant`, or disconnected): show "Connect Gmail" again. `mailbox` is shown while the
  sealed token blob is readable, otherwise `null`.
- The address is stored **inside the encrypted token blob** (same AES-GCM key and `tokens` purpose as the tokens), so it
  disappears on disconnect and delete-all. Accounts saved before #109 have no address: the first `GET /api/account`
  with a still-valid access token fetches it once from Gmail's profile (audited as `gmail.fetch`) and re-seals it.
- `lastSyncAt`: set when a Gmail sync publishes; `null` before the first sync, after delete-all / clearing the ledger,
  and when a sync fails or is discarded. `syncing` is true while a sync for this account is running.
- `counts` are visible rows (excluded merchants removed), the same as `/api/ledger`.

`POST /api/auth/disconnect` (same-origin, signed-in): clears the stored tokens + mailbox, then revokes the Google grant
(best effort, like delete-all) -> `{ disconnected: true, revokedToken }`. The user row, session cookie and **synced
ledger are kept** (the UI labels it "Gmail disconnected"). Writes an `approval` audit entry "Gmail disconnected"
(no new audit type). Calling it again is harmless (`revokedToken: false`). Reconnecting through `/api/auth/google`
reuses the same account and ledger.

Token requirement (behaviour change): data routes (`/api/ledger`, orders, findings, claims, audit, review, merchants,
demo, upload, account, delete-all) only need a valid identity, so an account with an expired or disconnected Gmail grant
still reads and edits its own ledger. Only `GET /api/gmail/preview` and `POST /api/gmail/sync` need a live grant and
answer `401 { code: "token_expired", reconnectUrl }` otherwise. Tampered / expired / deleted identities still get 401
and their cookies cleared on every route.

Client: `getAccount()`, `disconnectGmail({ accountId? })`. After `disconnectGmail`, a Gmail sync, or `deleteAll`, refetch the account
and the ledger (shared-cache invalidation point). UI: `useAccount()` (cache key `account`), the `/account` page and the
header "Sync emails" button (#110, #112) read it.

## Multiple Gmail accounts (issue #114)

A **profile** is the session identity (the account store scope holds **one merged ledger**). Gmail mailboxes are accounts
of that profile; each has its own sealed tokens (mailbox inside the blob), refresh/expiry, `lastSyncAt` and can be
disconnected on its own.

- **Add an account:** navigate to `/api/auth/link` (`gmailConnectUrl({ link: true })`; Google asks which account).
  The callback links the mailbox to the profile of the current session instead of switching identity, then returns to
  `/sync` as usual. Linking a mailbox the profile already has (also one that was disconnected) refreshes that account
  instead of adding a copy. Without a valid session, or or when `/api/auth/google` started the flow, the callback behaves as before (the mailbox
  signs in as its own profile).
- **Account ids:** `accounts[].id`. The profile's own mailbox is the account whose id is the user id (no migration of
  existing rows: `user.token_enc` stays its token); further mailboxes are rows of `linked_account`
  (`id, user_id, identity = mailbox hash, token_enc, created_at`). Mailbox addresses live only in the sealed blob, so a
  disconnected account stays listed (`connected: false, expired: true, mailbox: null`) and keeps its purchases.
- **Disconnect:** `POST /api/auth/disconnect { accountId }` clears and revokes one account and leaves the others
  connected; without a body every account is disconnected. The ledger is always kept. **Delete-all** revokes every
  account (best effort), removes the profile with all linked accounts and the ledger.
- **Sources:** `RawEmail.sourceAccount?` (linked account id, set by the Gmail sync) and `NormalizedOrder.sources?: string[]`
  (sorted account ids of the inboxes that contributed; absent for demo / upload data). Order ids are merchant + order
  ref, so the **same order seen in two inboxes is one order** with both sources, and rules do not count it twice.
- **Merge strategy:** the store keeps the last published `PipelineResult` of **each account**
  (`setAccountPipelineResult`). Every publish rebuilds the Gmail ledger from all of them (`mergeAccountResults`):
  orders with the same id are merged (`mergeSameOrder`: union of events / emails / sources, amounts from the
  confirmed copy), rules rerun only for merged orders, all other findings are kept as produced. Syncing account A
  therefore replaces only A's contribution; B's orders stay. Finding statuses and claim drafts carry over by finding id
  as in #77 / #79. A demo load, upload or clear replaces the whole ledger and forgets the per-account results. Limit:
  an order without an order reference is not recognized across inboxes. Hand corrections in the review flow last
  until the next sync of any account (as before for a re-sync).
- **Preview / sync:** `GET /api/gmail/preview[?accountId=]` and `POST /api/gmail/sync { confirmed: true, accountId? }`
  act on one account, or by default on **every** account, one after another. Responses keep their top-level fields
  (summed over the accounts that worked) and add `accounts`: preview entries are
  `{ accountId, mailbox, ok: true, estimatedMessages, messagesToFetch }`, sync entries
  `{ accountId, mailbox, ok: true, fetched, capped }`; an account that could not be read is
  `{ accountId, mailbox, ok: false, code }` (`token_expired`, `gmail_access_denied`, `sync_timeout`, ...) while the others
  still publish. The call fails (with the first error, like a single-account sync) only when no account succeeded; an
  unknown `accountId` is 404 `account_not_found`. `parseErrors` entries carry their `accountId` in a multi-account sync.
- **Time budget:** the 240 s sync budget (`SYNC_BUDGET_MS`, below the route's `maxDuration` of 300 s) is **shared**:
  account *i* of *n* gets an equal share of what is left, so an account that finishes early leaves its time to the
  next. An account that exceeds its share fails with `sync_timeout` on its own. Each account has its own request
  pacer (quota is per user, so a profile's accounts do not compete). One sync per profile at a time (409).
- **Progress:** `GET /api/gmail/sync/status` keeps `{ stage, fetched, total, skipped }` (summed over accounts, `total`
  is `null` until every account knows its own) and, when **several accounts** are synced, adds
  `accounts: [{ accountId, mailbox, stage, fetched, total }]` (`idle` = waiting for its turn, `failed` for an account
  that could not be read). A single-account sync keeps the plain shape.
- Client: `getAccount()`, `disconnectGmail({ accountId? })`, `getGmailPreview({ accountId? })`, `syncGmail({ accountId? })`,
  `gmailConnectUrl({ link? })`.

## Gmail routes (issues #38, #103, #112)

Details and error codes: `docs/gmail-sync.md`. All three need the signed-in session cookie; the data routes above do not
need a live Gmail grant, these do (401 `token_expired` + `reconnectUrl` otherwise). Error bodies are
`{ error, code? }` (`ApiErrorBody.code`).

| Method + path | Request | Response (200) | Errors (`code`) |
|---|---|---|---|
| `GET /api/gmail/preview` | optional `?accountId=` | `GmailPreviewResponse` `{ query, estimatedMessages, messagesToFetch, countIsEstimate, windowDays: 90, maxMessages: 50, accounts }` | 401 `token_expired`, 404 `account_not_found`, 429 `gmail_rate_limited`, 502 / 503 |
| `POST /api/gmail/sync` | `{ "confirmed": true, "accountId"? }`, same-origin | `GmailSyncResponse` = `PipelineRunResponse` (`mode: "gmail"`) + `{ fetched, capped, parseErrors, accounts }` | 400 not confirmed, 401 `token_expired`, 404 `account_not_found`, 403 `gmail_access_denied` / cross-origin, 409 `sync_already_running` (or data deleted meanwhile, nothing saved), 422 `no_parseable_messages`, 429 `gmail_rate_limited`, 504 `sync_timeout`, 502 / 503 |
| `GET /api/gmail/sync/status` | none | `GmailSyncStatus` `{ stage: "idle" \| "listing" \| "fetching" \| "processing" \| "complete" \| "failed", fetched, total: number \| null, skipped, accounts? }` (in-process, kept 15 minutes) | 401 `token_expired` |

- A sync reads at most **50** messages **per account** (`maxMessages`, last 90 days) and has a **240 s** budget (shared by the accounts, see "Multiple Gmail accounts"): when it runs out the
  route answers **504 `sync_timeout`** and publishes nothing (the previous ledger is unchanged).
- The sync is one request. While it runs, poll `/api/gmail/sync/status` (about every 1.5 s) for live counts;
  `stage` `complete` / `failed` may be left over from an earlier run, so only the in-flight stages say anything about
  the current one. `GET /api/account` also reports `syncing: true` while one runs for the account.
- Client: `getGmailPreview()`, `syncGmail()` (sends `{ confirmed: true }`, so call it only after the user confirmed the
  preview), `getGmailSyncStatus()`; all throw `ApiError` (`status`, `body.error`, `body.code`) and
  `toGmailFailure(error)` reduces any thrown value to `{ status, code, error }` (`status: 0` = network failure).
  `runGmailSync()` in `@/hooks/syncRun` wraps `syncGmail()` for UI use: one sync at a time per tab, and the shared cache
  is refreshed afterwards even when it fails.

## Owed summary and finding status (issue #77, Option A)

Approving a claim does not mean the money came back, so an approved claim keeps counting until the user resolves it:

| Finding `status` | Order doesn't need review | Order needs review (rule 7) |
|---|---|---|
| `open` | counts toward `owedTotal` | `excludedCount` / `excludedTotal` |
| `drafted` ("claim sent", set by approving a claim) | counts toward `owedTotal` **and** `claimSentCount` / `claimSentTotal` | `excludedCount` / `excludedTotal` |
| `resolved` (money came back) / `dismissed` | never counted | never counted |

An order needs review when `needsReview` is set, or when `confMin < 0.7` and no human confirmed it (`review.confirmedAt`,
#47); `orderNeedsReview` lives in `src/lib/rules/owed.ts`.

`summary` (`LedgerSummary` = `Required<OwedSummary>`) fields, every amount rounded to cents:

| Field | Meaning |
|---|---|
| `owedTotal`, `findingCount` | open + drafted findings on orders that don't need review |
| `claimSentTotal`, `claimSentCount` | the drafted subset of `owedTotal` / `findingCount` (show as "claim sent") |
| `excludedTotal`, `excludedCount` | open + drafted findings held out because their order needs review (or is missing) |
| `currency` | the first counted finding's currency, else `"USD"`. Amounts are not converted: mixed-currency ledgers are a known follow-up |

`OwedSummary` in `src/lib/types.ts` declares `claimSentCount` / `claimSentTotal` optional only so hand-written view
fixtures stay valid; the API always sets them.

`POST /api/findings/:id/status` sets a status by hand: `resolved` when the refund / adjustment arrived, `dismissed` when
the user doesn't want to pursue it, `open` to undo either (or to take back a "claim sent"). `drafted` can't be set
here: only `POST /api/claims/:findingId/approve` sets it. Each change writes an `approval` audit entry
`Finding <id> marked <status> (was <previous>) by the user`. Client: `setFindingStatus(id, status)`.

Statuses survive a pipeline re-run in the same store (account) scope: `setPipelineResult` copies the previous status
onto findings with the same deterministic id (`${kind}:${orderId}[:${lineItemId}]`), so drafted / resolved /
dismissed stick across demo reloads, uploads and Gmail syncs. Findings the rules no longer produce (e.g. the refund
arrived) simply disappear. Delete-all and `DELETE /api/demo` clear the findings first, so nothing carries over.
Claim drafts are still cleared by a re-run (a drafted finding keeps its status; re-open the claim to see a fresh draft).

## Pipeline

`runPipeline` (`src/lib/pipeline/run.ts`) is shared by demo, upload and Gmail sync:
`isReceiptLike` (demo/upload only) → `classify` (raw email, for phishing detection) → `redact` → extractor on the
redacted email (marketing / not_receipt are never extracted) → `matchOrders` → `runRules(defaultRules)`.
Demo mode (`loadSeedDemo` in `src/lib/demo`) runs `seed/inbox.json` with `now = asOf` and the simulated seed
price feed, fully offline: recorded LLM output from `seed/llm-cache.json` when present, otherwise gold labels.

## Swapping the UI from mocks to the API

The client in `src/lib/api/client.ts` returns the same shapes as `@/lib/mock/data`, but asynchronously, and throws
`ApiError` (`status`, `body.error`) on non-2xx:

| Mock (`@/lib/mock/data`) | Client (`@/lib/api/client`) |
|---|---|
| `orders`, `findings`, `owedSummary()` | `const { orders, findings, summary, mode, labels } = await getLedger()` |
| `getOrder(id)` | `(await getOrder(id)).order` (+ `.findings`) |
| `getFinding(id)` | `(await getFinding(id)).finding` (+ `.order`) |
| `auditLog` | `await getAudit()` |
| `DEMO_LABEL`, `SIMULATED_PRICE_LABEL` | `labels.demo`, `labels.simulatedPrice` from `getLedger()` |
| (none) | `loadDemo()`, `resetDemo()`, `uploadFiles(files)`, `getPrefilter()`, `deleteAll()`, `excludeMerchant(name)`, `includeMerchant(name)`, `setFindingStatus(id, status)`, `getSessionStatus()` |

```ts
// before
import { findings, orders, owedSummary } from "@/lib/mock/data";
// after (client component)
import { ApiError, getLedger } from "@/lib/api/client";
const ledger = await getLedger(); // ledger.orders, ledger.findings, ledger.summary
```

Drafts (`getDraftForFinding`) are served by the claims routes below (#35).

## Claims (issue #35)

Claim drafts for one finding, built by `draftClaim` (`src/lib/claims`, #32) from the finding, its explain payload
and the order. **The app never sends email:** approval only records consent and returns a `mailto:` URL and
clipboard text for the user to send from their own mail client (AGENTS.md hard rule 2). Every amount and date in a
draft comes from the rules (hard rule 4). `:findingId` is URL-encoded (`encodeURIComponent`).

| Method + path | Request | Response (200) | Errors |
|---|---|---|---|
| `GET /api/claims/:findingId` | none | `ClaimResponse` `{ draft, finding, order }`: the stored draft, or a fresh template draft (then stored) | 400 empty id, 404 unknown / excluded / deleted, 422 no claim template |
| `POST /api/claims/:findingId` | optional JSON `{ profileName?, supportEmail?, rephrase?: boolean }` (empty body = defaults) | `ClaimRegenerateResponse` = `ClaimResponse` + `{ rephrased, reason? }` | 400, 404, 422 |
| `PUT /api/claims/:findingId` | `{ subject (1-300), body (1-10000), recipient ("" or email, max 320) }` | `ClaimResponse` with the edited draft | 400, 404, 422 |
| `POST /api/claims/:findingId/approve` | none | `ClaimApproveResponse` `{ draft, mailtoUrl, clipboardText }` | 400, 404, 409 no draft yet (GET first) |

`draft` is a `ClaimDraftRecord`: the `ClaimDraft` from `src/lib/claims` (`id`, `findingId`, `kind`, `subject`,
`body`, `recipient`, `recipientVerified`, `signedName`, `facts`, `warnings`, `note?`, `approvedAt?`) plus
`edited` and `rephrased` booleans.

Notes:
- 422 bodies are `{ error: <draftClaim message>, details: { reason } }` with `reason` `"unsupported_kind"`
  (e.g. `rewards_gap`), `"order_mismatch"` or `"invalid_finding"`.
- Deadline warnings ("... has passed") use the ledger clock `asOf` (the seed date in demo mode).
- `POST` regenerates from the template and discards user edits and any approval. With `rephrase: true` and
  `ANTHROPIC_API_KEY` set, the LLM rewords the body; the result is fact-checked (every cited fact verbatim, no new
  numbers) and an `llm_call` audit entry is written. Without a key, or when the check fails, the template is kept and
  `rephrased: false` with a `reason`. The key is never returned or logged.
- `PUT` keeps the template `facts` and `warnings`, sets `edited: true`, and clears `approvedAt` (the new text was not
  approved). When a cited fact no longer appears in the body it adds the warning
  `Edited body no longer contains: <label> (<value>), ...` because the user may have changed a number.
- `approve` sets `approvedAt`, sets the finding's `status` to `"drafted"`, and writes an `approval` audit entry that
  names the draft and finding but never the subject or body. Approving again refreshes `approvedAt`. A drafted finding
  keeps counting toward `owedTotal` (and `claimSentTotal`) until it is marked `resolved` or `dismissed` (#77).
- Excluded merchants and delete-all apply: their findings and drafts 404 on every claims route.

Client (`src/lib/api/client.ts`): `getClaim(findingId)`, `regenerateClaim(findingId, { profileName?, supportEmail?,
rephrase? })`, `saveClaim(findingId, { subject, body, recipient })`, `approveClaim(findingId)`.

## Server helpers and hooks for pages (issue #48)

Page wrappers never call `fetch` on the JSON routes themselves and never import `@/lib/store`. Pick one:

**Server component `page.tsx`** -> `src/lib/api/server.ts` (Node only; never import it from `"use client"` files or
middleware). Each helper returns the same body as its route, read from the same account store:

| Helper | Same as | Missing item |
|---|---|---|
| `getLedgerForRequest(): Promise<LedgerResponse>` | `GET /api/ledger` | |
| `getOrderForRequest(id): Promise<OrderResponse \| null>` | `GET /api/orders/:id` | `null` |
| `getFindingForRequest(id): Promise<FindingResponse \| null>` | `GET /api/findings/:id` | `null` |
| `getAuditForRequest(): Promise<AuditResponse>` | `GET /api/audit` | |
| `getClaimForRequest(findingId): Promise<OpenedClaim>` | `GET /api/claims/:findingId` (stores a fresh template draft) | `{ ok: false, reason: "not_found", message }`; draftClaim failures (e.g. `"unsupported_kind"` for rewards_gap, route 422) use the same shape. Success: `{ ok: true, claim: ClaimResponse }` |

Scope: the helpers read the session cookie through `cookies()` with `getSession()` (`src/lib/auth/session.ts`). A
session (Gmail connected or not) reads that account's store, so a signed-in user never sees the anonymous demo. No
cookie, or a stale / invalid / expired cookie or a deleted account, reads the anonymous demo/upload store. Auth config
or DB failures throw (fail closed). The JSON routes (`withAccountStore`) answer a stale cookie with 401 instead.

**Client component** -> `@/hooks` (`src/hooks/**`), built on `@/lib/api/client`:
- Reads return `{ data, error, loading, refetch }`: `useLedger()`, `useOrder(id)`, `useFinding(id)`, `useAudit()`
  (entries newest first), `useClaim(findingId)`, `useSession()` (`SessionStatus` from `GET /api/auth/session`;
  `connected: false` is normal in demo mode), `useAccount()` (`AccountResponse` from `GET /api/account`),
  `useGmailSyncStatus(active)` (polls `GET /api/gmail/sync/status` every 1.5 s, only while `active`).
- Mutations return `{ run, pending, error }`; `run(...)` resolves to the response or `null` on failure:
  `useLoadDemo()`, `useSetFindingStatus()`, `useSaveClaim()`, `useApproveClaim()`, or `useAction(anyClientFn)`.
  A successful `run` invalidates the shared read cache and waits for the refetch, so no `refetch()` call is needed.
- Reads come from a shared client cache (`src/hooks/cache.ts`, issue #108): repeat visits render cached data at once
  (`loading` is true only while nothing is cached) and refresh in the background when it is older than 5 s; requests for
  the same endpoint are deduplicated (page and app shell share one). After a mutation that does not go through
  `useAction` (Gmail sync, review confirm), call `invalidate(keys?)` from `@/hooks`: keys are `ledger`, `session`,
  `account`, `audit`, `order`, `finding`, `claim` (a kind matches every `kind:id`); no argument invalidates everything.
  Mounted reads refetch immediately and keep their data on screen; unmounted ones are dropped.

Ids: pass `params.id` as is. Next 15 hands it over still percent-encoded and real ids contain `:`; the helpers and
the client decode once with `safeDecode` (exported from `@/lib/api/client`) before encoding, so ids are never
double-encoded.

```tsx
// server component: src/app/ledger/[id]/page.tsx
const data = await getOrderForRequest((await params).id);
if (!data) notFound();
return <OrderDetail order={data.order} findings={data.findings} />; // a client wrapper passes onBack to the view
// client component
const { data, error, loading, refetch } = useLedger();
```

## Quality tracking (issue #117)

Tracks and optimizes receipt quality on real data. Everything is per store scope (the signed-in profile, or the anonymous
demo), `Cache-Control: no-store`, and built from counts, safe metadata and **redacted** text: no raw bodies, addresses or
`To` headers are kept. Code: `src/lib/quality/**`, `src/lib/eval/real.ts`.

| Route | Purpose |
|---|---|
| `GET /api/quality` | `{ latest: SyncQualityReport \| null, history: SyncQualityReport[] }`: one report per finished run (Gmail: per account; upload; demo), history capped at 20, oldest first |
| `GET /api/quality/skipped` | `{ skipped: SkippedEmail[], total }`: emails that produced no order |
| `POST /api/quality/skipped/:emailId/receipt` `{ class? }` | "This is a receipt": extracts the email (receipt path forced; cache first, else Claude), merges it through the normal matcher + rules, saves a label, writes an audit row, removes it from the list. Returns `{ emailId, class, extracted, needsReview, orderId, excludedMerchant, labeled, summary }`. No Claude key / provider down: 503 with `details.labeled: true` (label saved, email stays listed) |
| `POST /api/quality/skipped/:emailId/not-receipt` | For a false positive (an extracted email): removes its order when it was the order's only email, saves a label, lists the email as skipped. An order that also holds other emails is kept (`keptSharedOrders`): fix it in Review |
| `GET /api/quality/eval` | Scores the saved labels: receipt-gate precision/recall (prefilter + classifier on the stored redacted text) and per-field extraction accuracy. **Cache only, never calls a model**: labels without a cached extraction are listed as `unscored` |
| `POST /api/quality/experiment` `{ model?, promptVariant? }` | Runs the labeled set (at most 50 labels with corrected fields, newest first) through `model` / `promptVariant` (`default`, `conservative`, `itemized`) and the current setting, returns both side by side (accuracy, per-field, calls, tokens, estimated USD cost). **Calls Claude** (once per label per side; the current side is answered from the live cache where possible). Does not change `LLM_MODEL`, the live cache or the ledger. Audited. 400 without labels, 503 without a key, 409 while one is running |

`SyncQualityReport`: `{ id, at, source: gmail|upload|demo, accountId?, fetched, prefilteredOut, classified: {class: n},
skippedNonReceipt, extracted, lowConfidence, extractionFailures, matchedOrders, findings, llmCalls, inputTokens,
outputTokens, bodySource: { plain, html } }`. `llmCalls` counts requests that left the machine (cache hits are free);
`bodySource` counts decoded Gmail messages and `.eml` uploads (zero for the demo and `.mbox` uploads).
`SkippedEmail`: `{ emailId, accountId?, from: { name, domain }, subject (redacted), date, reason: prefilter|marketing|not_receipt|phishing, classConfidence }`.

**Labels** live in the `quality_label` table of the same SQLite file as the Gmail accounts (`DATABASE_URL`, default
`./papertrail.sqlite`, gitignored), keyed by store scope and email id (latest correction wins): `{ emailId, accountId?,
source: review|feedback, class, fields (corrected, or null), redactedText, textHash, subject, from (sanitized: name +
domain), date, at }`. Review edits label only the edited field, a confirmation labels every field shown (orders built
from one email only); "receipt / not a receipt" feedback labels the class only (`fields: null`), because model output is
not ground truth. Feedback labels also override the classifier (and bypass the prefilter) on the next sync / upload of
the same email id. `POST /api/delete-all` removes the scope's labels. The table is created on first write; reads and
delete-all never create the database file.

Redacted texts of the latest run are kept in memory only (max 400 emails, skipped ones first) so feedback and labels need
no re-fetch; delete-all and a demo reset clear them. Typed client: `getQualityReports`, `getSkippedEmails`,
`markSkippedAsReceipt`, `markNotReceipt`, `getQualityEval`, `runQualityExperiment`. UI: the "Quality" section of `/eval`
(`QualitySection`, data via `useQuality`).
