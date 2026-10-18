# PaperTrail architecture

This describes the implementation checked against the source, rather than the original build plan. Route contracts are in [api.md](api.md); Gmail operational details are in [gmail-sync.md](gmail-sync.md).

## 1. Inputs and shared pipeline

`src/lib/pipeline/run.ts` exposes both `runPipeline(emails, deps)` and the incremental `createPipelineRun(deps, total)` interface. The batch runner feeds the same incremental pipeline used by Gmail.

| Source | Entry point | Extraction / clock |
|---|---|---|
| Synthetic demo | `src/lib/demo/seed.ts: loadSeedDemo`, `POST /api/demo` | Recorded seed cache if available, otherwise gold labels; seed `asOf`; no provider calls |
| `.eml` / `.mbox` import | `src/lib/demo/eml.ts`, `upload.ts: runUploadPipeline`, `POST /api/upload` | Scoped memory cache, seed-cache fallback, then Claude; request time |
| Gmail | `src/lib/gmail/service.ts: syncGmail`, `POST /api/gmail/sync` | Scoped cache then Claude; sync time |

```text
RawEmail -> receipt prefilter -> classify(raw, locally) -> prepareForLlm (redact when PAPERTRAIL_REDACT=on)
         -> validated extraction -> matchOrders -> runRules -> orders/findings/review
```

The classifier sees the raw email locally to recognize forwarded sender domains and phishing look-alikes. Marketing and non-receipt classes are skipped for extraction. Excluded merchants are filtered from matched orders before rules and from store responses; exclusion does not prevent Gmail retrieval or extraction. Review items retain a reason and stage, including failures that cannot produce an editable order.

`PipelineDeps` supplies the extractor, audit sink, excluded merchants, clock and optional price feed. Extraction has bounded concurrency (default four), backpressure, and deterministic input ordering despite out-of-order completion. The matcher/rules operate on completed extraction results. `PipelineStats` distinguishes extraction origins (`llm`, `cache`, `gold`).

## 2. Gmail sync and progress

`src/lib/gmail/client.ts` performs Gmail API listing and full-message retrieval, with receipt query/window from `src/lib/ingestion/prefilter.ts`. The current cap is 50 messages from the last 90 days. `capped` follows the list response's `nextPageToken` at the limit. `previewGmail()` returns the query, estimated matching count and fetch limit before the user confirms.

`service.ts` uses two bounded fetch workers and a shared request pacer. Messages enter `createPipelineRun` in listing order as soon as they can be accepted; fetching and extraction overlap. It has a sync budget and aborts workers on completion/failure. A fetch/provider outage fails the replacement sync instead of publishing a partial ledger; malformed/unavailable individual messages can become review items. A batch with messages but none parseable fails.

`src/app/api/gmail/sync/route.ts` requires `{confirmed:true}`, prevents overlapping syncs for one account, and publishes a successful result with `setPipelineResult`. `beginStoreWork()` in `src/lib/store/index.ts` captures a generation: a concurrent delete/reset invalidates the in-flight result so it cannot repopulate deleted data. The route also checks that the authorization is still active before publication.

`src/lib/gmail/progress.ts` retains per-account stages (`listing`, `fetching`, `processing`, terminal states). The progress route is polled by the client. The POST remains a bounded request, not a durable background job; progress and ledger state are process-local.

### MIME and body selection

`src/lib/gmail/decode.ts` walks nested MIME parts, bounds decoding, ignores attachments and non-text content, and produces `RawEmail`. `src/lib/ingestion/mime.ts` is shared with `.eml` import: `selectBodyText` prefers plain text unless HTML contains richer purchase evidence, then `htmlToText` preserves useful table structure. Script/style/hidden content is stripped. This is string processing, not a browser: no email JavaScript executes and no remote images/resources are requested.

## 3. Redaction, extraction and caching

**Redaction switch (#125).** `PAPERTRAIL_REDACT=on|off` (default **off**, a local-demo decision) is read by `prepareForLlm(raw)` in `src/lib/ingestion/prepare.ts`, the one helper every LLM path uses (pipeline extraction, claim rephrase, the debug route, "This is a receipt" re-extraction and quality experiments). `on` = today's `redact()` (below). `off` = subject and text unchanged, all redaction counts 0, `html` still dropped, `textHash` = SHA-256 of the unredacted text (so the two modes never share cache entries; `eval/run.ts` computes its cache keys with the same helper). Audit rows are written for every LLM call in both modes. The mode is exposed as `redaction: "on"|"off"` on `GET /api/account`, `GET /api/prefilter` and `GET /api/gmail/preview`, and the Sync copy follows it. With `off`, the text kept for Review and quality labels is unredacted; it is stored locally only. Text stored under one mode is re-prepared for the current mode before it is sent to Claude again. The extraction prompt still mentions `[PAN_1]`-style tokens; with `off` there are none.

Everything below describes the `on` mode.

`src/lib/ingestion/redact.ts` tokenizes recognized email addresses, Luhn-valid card numbers, international and contextual bare phones, street/postal addresses and recognized customer names in subject/body, preserving labeled order/tracking references and last-four mentions. HTML is dropped. Token numbering is shared within an email; `textHash` is SHA-256 of the redacted body.

This is pattern-based redaction, not complete anonymization. `names.ts` uses recipient display names and customer/shipping/salutation hints. The extraction prompt requests null customer names; validated model output drops reconstructed names/evidence. Claims use a known name when supplied and “Customer” when none is available or a redaction placeholder remains.

**What redaction covers (#123).** Prices, dates, brands, product names and order/SKU/tracking references must survive redaction, so the patterns are context-gated rather than broad.
- *Phones:* `+CC` numbers (grouped, 10+ digits, or after a phone label), US formats, bare 10–11 digit runs after a phone label, and local-format numbers (`020 7946 0958`, `07911 123456`, `03-1234-5678`, `0044…`) only directly after a label such as Tel/Phone/Mobile/Call/Tél/Telefon. Digits after Order/SKU/Tracking/ZIP/Postal labels, `+1234567 pts` and `〒150-0002` are left alone.
- *Addresses:* number + street name + a known suffix (Street … Gardens, Close, Crescent, Square; optional direction and unit), French/German/Dutch/Spanish/Italian street forms, PO Box, and postal tails. A `City, ST 12345` or `Toronto, ON M5V 2B7` line is redacted anywhere; looser tails (`London SW1A 2AA`, `10115 Berlin`, `Toronto ON …`) only directly under a street or an address label, or after a street on the same line. A bare `12800 JPY` or `2026 Spring Sale` line is never an address.
- *Names:* the To display name (also `"Doe, Jane"`), its first name, a surname of 4+ characters and `Ms. Doe` forms; full names in `Customer`/`Ship to`/`Bill to`/`Cardholder`/`Account holder`/`Name on card`/`Placed by`/`Order for`/`Thanks for your order, …` lines (two or more words, never an organisation, a place such as Home/Office/Locker, the sender, or a Customer/Member filler). A first name seen only in a salutation is redacted in that salutation line only, so `Hello Jordan` does not hide `Jordan 1 Retro`.
- *Not covered:* non-Latin scripts and Indian/Japanese-style addresses (`Flat 12, MG Road`), unlabeled national-format phones (`03-1234-5678` on its own), names without a label or To header (signatures, `Regards, Jane`), and anything in images or attachments. Redaction is best-effort, not anonymization.

`extract-prompt.ts` sends only the sender domain, email date, redacted subject and text to the forced `record_extraction` tool. `extract.ts` validates the response with the canonical Zod schema, retries invalid output once, and routes persistent invalid output to Review. Provider exceptions are audited, then handled by the pipeline; Gmail applies its stricter fail-the-replacement policy. Confidence is the minimum across present extracted fields.

`src/lib/llm/anthropic.ts` uses the Anthropic Messages API over `fetch`, with the runtime environment key, configured/default model and timeout. `FixtureLlmClient` is the offline test client.

`src/lib/ingestion/cache.ts` supplies memory/file caches keyed by `textHash`. Valid results are cached; cache hits reuse fields with the current classification. Uploads layer the scoped memory cache over the read-only seed cache; Gmail uses its scoped memory cache. Demo mode falls back to `extractionFromGoldLabel` in `src/lib/pipeline/gold.ts` when recorded seed outputs are absent. Gold labels are precomputed data, not model measurements.

Only real provider attempts emit `llm_call` audit rows. Cache/gold provenance remains in pipeline extraction-origin statistics, including offline demo runs.

## 4. Matching, rules, review and claims

`src/lib/orders/matcher.ts: matchOrders` groups merchant/order references and lifecycle emails into canonical `NormalizedOrder` records. It deduplicates events and preserves evidence and stated policy. Missing confirmation/currency or low confidence marks an order for review.

`src/lib/rules/index.ts` defines the default pure rules:

| Rule | Findings |
|---|---|
| `refundRule` (`refund.ts`) | Overdue refund after return/SLA; short refund beyond tolerance |
| `returnRule` (`return.ts`, `policies.ts`) | Approaching return deadline, with policy/default window and lifecycle exclusions |
| `priceDropRule` (`pricedrop.ts`) | Eligible price decrease within adjustment window; mock observations marked simulated |

Rules take an injected `now` and price feed. Monetary amounts, due dates, thresholds, rounding and owed sums come from these deterministic modules, not the LLM. `src/lib/rules/owed.ts: computeOwed` excludes uncertain/resolved/dismissed items and keeps separate currency totals; it never performs FX conversion. Approved/drafted claims remain part of the outstanding amount until their finding is resolved/dismissed.

`src/lib/review/**` and `/api/review/**` support validated edits and confirmation, with revisions for stale requests. Confirmation reruns rules while preserving existing finding statuses by id. Low-confidence orders do not contribute money until confirmed. Unreadable messages without an order are shown separately rather than fabricated as editable purchases.

`src/lib/claims/draft.ts` builds templates from deterministic finding/order facts. It currently chooses the receipt customer name, then an optional profile-name argument, then “Customer”; no new account display-name source is required. Optional rephrasing (`rephrase.ts`) excludes the signature, Zod-validates wording, checks facts/numbers and falls back to the template on failure.

`src/lib/api/claims.ts` and `/api/claims/**` handle draft/read/edit/approve operations; `/api/findings/[id]/status` handles resolution/dismissal. Drafts and approvals survive pipeline reruns for surviving findings; changed facts produce a warning. An approval writes audit state and returns clipboard/mailto handoff information. The claim view uses the server approval state and mailto URL, hides email handoff after unsaved edits, and never sends email. “Claim sent” state represents user-approved handoff, not delivery confirmation.

## 5. Identity, scoped state and deletion

`src/lib/auth/config.ts`, `service.ts`, `google.ts` implement the read-only Google OAuth flow with state/PKCE. The callback verifies the mailbox through Gmail's profile endpoint. Credentials/session data are sealed with AES-256-GCM; no send/modify scope is requested.

`getSession(request?)` in `src/lib/auth/session.ts` returns `{userId,gmailConnected}|null`. A valid identity can remain after Gmail credentials expire or are disconnected. Gmail operations require a usable grant; reading/editing existing account data and deleting it need only valid identity. Invalid/stale identity cookies are cleared by route helpers; config/DB errors fail closed.

`src/lib/gmail/context.ts: withAccountStore` resolves the session and runs handlers inside `src/lib/store/index.ts: withStoreScope`. Stores are held on `globalThis`, selected with `AsyncLocalStorage`. Authenticated accounts are separate from the anonymous demo/upload store. Anonymous visitors share that store. `src/lib/api/server.ts` gives server page wrappers the corresponding scoped reads. There is no durable ledger database or multi-process ledger coordination.

SQLite persistence is initialized by `src/lib/auth/store.ts` using Drizzle schemas in `src/db/schema/`. It persists identities, sealed tokens and auth audit, not the in-memory ledger. Auth audit actions include OAuth lifecycle and Gmail fetch records; `/api/audit` serves the separate scoped application audit.

`GET /api/account` returns safe connection/mailbox/status/counts without tokens. `POST /api/auth/disconnect` clears Gmail credentials, attempts Google revocation and retains the identity and ledger. Subsequent Gmail calls require reconnecting.

`POST /api/delete-all` accepts a valid identity even without tokens, attempts per-account revocation, removes the identity and credentials, purges the active store/cache/exclusions, and clears auth cookies. The response reports real purge counts and confirmed revocation status. The app audit retains a delete receipt; SQLite deletion removes subject-linked rows and inserts an `oauth.deleted` tombstone with null subject. Anonymous deletion does not revoke another account's credentials.

## 6. Client/UI boundary

`src/components/views/**` are props-driven views. Thin pages fetch through shared hooks (`src/hooks/data.ts`, `actions.ts`, `src/lib/api/client.ts`) or server helpers; views do not own API/store/auth access. `ShellStateProvider` shares current source/account state with the shell.

`src/hooks/cache.ts` and `useCached.ts` provide stale-while-revalidate reads, deduplicate in-flight requests, and invalidate mounted/unmounted keys after mutations. Explicit errors remain visible; obsolete responses after invalidation are ignored. This browser cache is separate from the server extraction cache.

Detail-page layouts check existence before their `loading.tsx` boundary can stream a successful status. Unknown orders/findings therefore return HTTP404 with the existing not-found view; valid pages compose existing skeletons while loading.

Visual tokens/components belong to Alex's [design system](design-system.md). Pages supply data/actions; the shell reflects empty/demo/upload/Gmail state. Preview fixtures remain in components rather than production page wrappers.

## 7. Evaluation and verification

`src/lib/eval/run.ts: runEval` evaluates synthetic seed/gold/expected-finding files at the seed clock. It reports classification all/dev/holdout metrics, safety routing, optional real-output extraction accuracy and oracle/realistic-routing finding metrics. `/api/eval` returns that report; `/eval` maps real held-out classification results to `EvalView`, labels synthetic data, and discloses that default gold extraction is not measured AI quality.

`src/lib/eval/gate.test.ts` fixes the holdout size and safety/precision/recall thresholds. Gold-based findings validate routing/matching/rules; the small visible synthetic holdout does not establish real-inbox performance.

Vitest covers ingestion, extraction/provider failures, matching/rules, scoped API/auth/review/draft flows and view state. Playwright (`e2e/`, dedicated port3107) covers product demo, approval/reload/edit, deletion receipts, eval retry, import preview and actual HTTP404 status. Fakes/fixtures replace real Google/Gmail/Anthropic calls. `.github/workflows/ci.yml` runs checks/build and browser journeys on Node22.
