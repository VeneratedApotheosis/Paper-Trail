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
| `POST /api/auth/disconnect` | none | `DisconnectResponse` `{ disconnected: true, revokedToken }` | 401 not signed in, 403 cross-site |
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
  "mode": "gmail", "asOf": "...", "lastSyncAt": "2026-10-18T01:02:03.000Z",
  "counts": { "orders": 45, "findings": 6, "reviewItems": 2 }, "excludedMerchants": [], "syncing": false }
```

- Anonymous (no cookie): `gmail: { connected: false, expired: false, mailbox: null }` plus the anonymous store's mode / counts.
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

Client: `getAccount()`, `disconnectGmail()`. After `disconnectGmail`, a Gmail sync, or `deleteAll`, refetch the account
and the ledger (shared-cache invalidation point).

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
  `connected: false` is normal in demo mode).
- Mutations return `{ run, pending, error }`; `run(...)` resolves to the response or `null` on failure:
  `useLoadDemo()`, `useSetFindingStatus()`, `useSaveClaim()`, `useApproveClaim()`, or `useAction(anyClientFn)`.
  Call `refetch()` on the affected reads after a successful `run`.

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
