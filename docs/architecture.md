# PaperTrail architecture

How an email becomes a finding, as implemented on `main`. Function and file names below are the real ones; anything
not built yet is marked with its issue number. HTTP routes are documented in [api.md](api.md).

## 1. Pipeline overview

Every input source goes through one code path, `runPipeline(emails, deps)` in `src/lib/pipeline/run.ts`:

```
RawEmail[] ─► [isReceiptLike]  ─► classify(raw) ─► redact ─► extractor(redacted) ─► matchOrders ─► runRules ─► Finding[]
              demo/upload only     rules, no LLM    PII→tokens  Claude / cache / gold                    R1, R2, R3
```

| Input source | Entry point | Prefilter | Extractor | Rule clock |
|---|---|---|---|---|
| Demo seed (`seed/inbox.json`) | `loadSeedDemo()` in `src/lib/demo/seed.ts`, called by `POST /api/demo` | `isReceiptLike` | `createSeedExtractor`: `seed/llm-cache.json` if present, else gold labels (offline, never calls a provider) | seed `asOf` (`2026-10-17T19:00:00Z`) |
| `.eml` / `.mbox` upload | `runUploadPipeline()` in `src/lib/demo/upload.ts`, called by `POST /api/upload` | `isReceiptLike` | `createLlmExtractor`: session cache, then the seed cache, then Claude | request time |
| Gmail | OAuth connect only (`src/lib/auth`, `/api/auth/*`). Message sync into `runPipeline` is **not built yet** (#3 follow-up) | `GMAIL_RECEIPT_QUERY` (planned as the `messages.list` query) | `createLlmExtractor` (planned) | sync time |

`runPipeline` never drops an email silently. Anything uncertain or failed becomes a `ReviewQueueItem`
`{ emailId, stage: "classify" | "extract" | "match", reason, orderId? }`. It also returns `PipelineStats` (per-class
counts, extraction origins `llm` / `cache` / `gold`, orders, findings, review count) and emits audit events.

## 2. Stages

### 2.1 Prefilter (`src/lib/ingestion/prefilter.ts`)

- `GMAIL_RECEIPT_QUERY`: `newer_than:90d` plus subject terms (order, receipt, shipped, delivered, return, refund,
  price adjustment, invoice, and Spanish pedido / reembolso / devolución) or sender terms (orders, receipts, shipping,
  returns, refunds, billing, auto-confirm). `describePrefilterQuery()` gives the plain-language version;
  `GET /api/prefilter` serves both.
- `isReceiptLike(email)` for inputs that skip Gmail search (demo, uploads): keep when the subject has a receipt
  keyword, the sender local part is transactional, the subject/body has an order number, or the body has at least
  two receipt phrases. Returns `{ keep, reason }`.

### 2.2 Classify (`src/lib/ingestion/classify.ts`)

`classify(email)` is deterministic regex rules, no LLM. Order of checks: unwrap forwarded mail, then phishing
look-alike signals (never a receipt class), then marketing (never an order), then lifecycle class by subject, then by
body, in the precedence cancel > refund > return_received > return_started > price_adjust > delivered > shipped >
order (subject hits win over body hits; a body lifecycle event wins over body order wording). Since #33, "shipped"
hits are ignored in return emails and in order confirmations without strong shipping evidence. Classes: `order`, `shipped`, `delivered`, `return_started`, `return_received`, `refund`, `price_adjust`, `cancel`,
`marketing`, `not_receipt`. Forwarded mail loses 0.05 confidence (0.15 when the original sender is unknown).

`runPipeline` classifies the **raw** email: redaction tokenizes addresses inside forwarded bodies, which would hide
a look-alike sender domain. Classification is local code, so no unredacted text leaves the process.
`marketing` and `not_receipt` emails are never extracted (`SKIPPED_EXTRACTION_CLASSES`); if their classification
confidence is below 0.7 they go to the review queue with stage `classify`.

### 2.3 Redact (`src/lib/ingestion/redact.ts`)

`redact(email): RedactedEmail` replaces, in subject and body:

| Kind | Token | Detection |
|---|---|---|
| email address | `[EMAIL_n]` | address pattern |
| card number | `[PAN_n]` | 13–19 digits with optional single separators, must pass Luhn |
| phone | `[PHONE_n]` | US formats with required separators |
| street address | `[ADDRESS_n]` | house number + capitalized street words + suffix, optional unit and `City, ST 12345` |

The same value maps to the same token within one email. Digit runs right after labels like "order", "tracking",
"SKU" or "#" are kept (they are references, not PII) unless card/phone words are also present. "Ending in 4242"
style last-4 mentions are kept. `html` is dropped. `redactions` counts replacements per kind, and
`textHash = sha256(redacted text)` is the cache key. `From`/`To` headers pass through unchanged on the
`RedactedEmail`, but they are never put in the LLM prompt (see section 5).

### 2.4 Extract (`src/lib/ingestion/extract.ts`, `extract-prompt.ts`, `src/lib/llm/`)

`extract(redacted, classification, deps): ExtractResult`

1. Skipped classes return `{ ok: false, skipped: true }`.
2. Cache hit on `textHash` returns the cached extraction (`cached: true`) and audits a zero-token `llm_call`.
3. Otherwise the LLM is forced to call the `record_extraction` tool. `AnthropicLlmClient` posts to the Anthropic
   Messages API over `fetch` (`ANTHROPIC_API_KEY`, model `LLM_MODEL` or `claude-haiku-5-5`, 30 s timeout).
4. The tool input is validated with `ExtractionSchema` (evidence quotes truncated to 200 chars first). On failure the
   prompt is re-sent once with the validation error appended (`buildRetryPrompt`). A second failure returns
   `{ ok: false, needsReview: true, reason }`.
5. `confMin` = the lowest confidence over present fields (a present field without a confidence counts as 0). Valid
   results are written to the cache.

Provider errors (`LlmUnavailableError` with no key, `LlmHttpError`, `LlmTimeoutError`, `LlmResponseError`) are thrown;
`runPipeline` catches them and queues the email for review with stage `extract`. Extractions with `confMin < 0.7`
also get a review item but still go to the matcher, where they mark the order `needsReview`.

`FixtureLlmClient` answers from canned tool inputs keyed by `textHash`, for tests and offline demo.
`extractionFromGoldLabel` (`src/lib/pipeline/gold.ts`) builds extractions from seed gold labels; these carry
`model: "gold"` and are audited as "Precomputed extraction from seed gold label, no LLM call".

### 2.5 Match (`src/lib/orders/matcher.ts`)

`matchOrders(inputs: MatchInput[]): NormalizedOrder[]`, pure and deterministic. The matcher receives the redacted
email.

- `marketing` / `not_receipt` are ignored.
- Emails group by normalized merchant (name, else domain) + order ref (case-insensitive).
- Emails without an order ref join the same-merchant order whose total is within max($0.50, 2%) and whose `placedAt`
  is within 3 days; otherwise they form their own order.
- The latest order confirmation wins for totals and line items; duplicate lifecycle emails produce one event.
- Class to event: `return_started` becomes `return_dropped` when the text says "dropped off"; `refund` becomes
  `store_credit` when `isStoreCredit` is set, else `refund_issued`.
- Policy comes only from facts stated in the order's emails (`policySource: "email_text"` or `null`): window,
  refund SLA, price-adjust days, policy quote. `windowAnchor` is `delivery` when the policy text says "of/after/from
  delivery". `nonReturnable` when policy or confirmation text says "final sale", "non-returnable" or "cannot be
  returned". There is no merchant default table yet; rules fall back to their own defaults.
- `needsReview = confMin < 0.7 || no order confirmation || no currency`.

### 2.6 Rules (`src/lib/rules/`)

`runRules(orders, rules, { now, priceFeed })` with `defaultRules = [refundRule, returnRule, priceDropRule]`:

- Orders with `needsReview` are skipped entirely (no findings until a human confirms them).
- Finding id = `${kind}:${orderId}[:${lineItemId}]`; the first finding per id wins, so reruns never duplicate.
- Every finding is validated with `FindingSchema`; an invalid one is a rule bug and throws.
- Severity by amount: high ≥ 100, medium ≥ 25, else low.
- Sorted by `dueAt` ascending (null last), then amount descending, then id.
- Rules never read the system clock. All date math is in fixed 24 h UTC periods (`addDays`, `daysBetween`); money is
  rounded to cents (`roundCents`).

Exact semantics are in section 4.

### 2.7 Claim drafts (`src/lib/claims/`)

- `draftClaim(finding, order, options)` builds a template email for `refund_overdue`, `refund_short`,
  `return_deadline` and `price_drop`. Every amount, date, order ref and policy quote is read from the finding, its
  `explain` payload or the order. It signs with the receipt's `customerName`, else `profileName`. The recipient is
  `supportEmail` when given, else guessed as `support@<merchant domain>` with `recipientVerified: false`.
  Simulated-price findings get the warning "Price comes from a simulated feed; verify the current price before
  sending."
- `rephraseDraft(draft, { llm })` is an optional wording pass. It sends the body without the signature, plus the
  list of facts that must survive. `factCheckRephrase` rejects the result if any fact value is missing or a new
  number appears, and the template draft is kept.
- `mailtoUrl` and `clipboardText` are the only hand-off paths. Nothing sends email.
- HTTP routes for draft / edit / approve are in progress in **#35**.

### 2.8 Store and API (`src/lib/store/`, `src/app/api/**`, `src/lib/api/`)

The store is in memory on `globalThis` (a server restart empties it). It holds orders, findings, drafts, the review
queue, the audit log, merchant exclusions and the session extraction cache, never raw emails. Excluded merchants are
removed before rules run and hidden from every response. `deleteAll()` calls the OAuth revoke hook if one is
registered (#3 has not registered it yet), purges everything, and leaves one `delete` audit record. Route list and
response types: [api.md](api.md). The UI reads only through `src/lib/api/client.ts`.

### 2.9 Eval (`src/lib/eval/`)

`runEval({ extractionSource, split, now })` composes classify → extraction → `matchOrders` → `runRules` at the seed
`asOf` and scores each stage against `seed/gold_labels.json` and `seed/expected_findings.json`: classification
metrics with a confusion matrix per split (all / dev / holdout), a safety count of phishing or marketing routed as an
order, extraction field accuracy (only when an extraction map of real model output is supplied), and finding
precision/recall in `oracle-extraction` and `realistic-routing` modes. `GET /api/eval` serves the report;
`gate.test.ts` enforces the CI thresholds. Current numbers are in the README.

## 3. Data contracts (`src/lib/contracts/`)

All shared shapes are Zod schemas, imported from `@/lib/contracts`, never copied.

| Schema | File | Purpose |
|---|---|---|
| `RawEmailSchema` | `email.ts` | Pipeline input from any source: `id`, `from`, `subject`, `date`, `text`, optional `html`, `threadId`, `to`, `labels` |
| `RedactedEmailSchema` | `email.ts` | `RawEmail` minus `html`, with redacted `subject`/`text`, `redactions` counts per kind, `textHash`. Only this shape may reach an LLM |
| `EmailClassSchema`, `ClassificationSchema` | `email.ts` | The 10 classes; `{ emailId, class, confidence, reason }` |
| `ExtractedFieldsSchema` | `extraction.ts` | merchant, merchantDomain, orderRef, date, currency, lineItems, totals, last4, customerName, eventAmount, returnWindowDays, refundSlaDays, priceAdjustDays, policyQuote, isStoreCredit. All nullable: unknown is allowed, guessing is not |
| `ExtractionSchema` | `extraction.ts` | `{ emailId, class, fields, confidence (per field), evidence (per field, ≤200 chars), confMin, model, cached }` |
| `REVIEW_CONFIDENCE_THRESHOLD` | `extraction.ts` | `0.7` |
| `OrderEventSchema`, `MerchantPolicySchema`, `NormalizedOrderSchema` | `orders.ts` | Matcher output and rules input: merchant + policy, order ref, totals, line items with `returnedQty`, sorted events, `messageIds`, `confMin`, `needsReview` |
| `FindingSchema` | `findings.ts` | Rules output: `id`, `kind`, `orderId`, `lineItemId?`, `amountAtStake`, `currency`, `dueAt`, `severity`, `status`, `ruleVersion`, `summary`, `evidence[]` (≥1), `explain`, `simulated` |
| `SeedInboxSchema`, `GoldLabelsFileSchema`, `ExpectedFindingsFileSchema` | `seed.ts` | Formats of the files in `seed/` |

`FindingKindSchema` also contains `rewards_gap` for the unbuilt rewards layer (#18); no rule produces it.
`PriceFeedSchema` / `PriceObservationSchema` live in `src/lib/prices/feed.ts` (sources `mock` and `email_promo`;
`seed/price-feed.json` omits `source`, which defaults to `mock`).

## 4. Rule semantics (exact, from `src/lib/rules/`)

### R1 refund (`refund.ts`, `R1@1`): `refund_overdue`, `refund_short`

- **Trigger T:** earliest `return_received` (strong); if none, earliest `return_dropped` or `return_started` (weak).
  No trigger, no finding.
- **SLA N:** `policy.refundSlaDays` when stated in the email, else 10 days (strong) or 14 days (weak).
  Expected-by `E = T + N`.
- **Expected amount:** Σ(returned qty × unit price) + tax × returnedSubtotal / subtotal, rounded to cents. Returned
  items are the trigger event's `lineItemIds` (item `returnedQty` when > 0, else full qty). No line item ids, unknown
  ids, or every item fully returned: the order total.
- Only events at or after T count. Any `store_credit` at or after T counts as matched: no finding.
- **`refund_overdue`:** no `refund_issued` at or after T and `now > E` (strictly). Amount = expected amount,
  `dueAt = E`. `now ≤ E` produces nothing.
- **`refund_short`:** refunds exist, all have amounts, and expected − Σ refunds > max($0.50, 2% of expected).
  Amount = the shortfall, `dueAt = null`. A refund without a stated amount counts as matched and is not checked.
- Confidence = lowest confidence of the events involved. Quote = policy quote, else the trigger event's evidence.

### R2 return deadline (`return.ts`, `policies.ts`, `R2@1`): `return_deadline`

- **Suppressed** when the policy is `nonReturnable`, or the order has any `cancel`, `return_started`, `return_dropped`
  or `return_received` event.
- **Window:** `policy.returnWindowDays` when stated; otherwise `DEFAULT_RETURN_WINDOW_DAYS = 30` counted from the
  order date (source `default`).
- **Anchor A:** earliest `delivered` event when the window counts from delivery and a delivered event exists, else
  `placedAt`. `deadline = A + window`.
- **Fires** when `0 ≤ deadline − now ≤ 7 days`. Amount = order total, `dueAt = deadline`, `daysLeft` rounded up.
- Confidence = order `confMin` (and the delivered event's confidence for a delivery anchor). Below 0.7 the explain
  payload sets `checkPolicy: true`.

### R3 price drop (`pricedrop.ts`, `src/lib/prices/feed.ts`, `R3@1`): `price_drop`

- Needs a price feed in the rule context; without one R3 emits nothing.
- Skipped for `nonReturnable` policies, cancelled orders, and orders with no source email.
- Per line item with a SKU and held qty = qty − returnedQty > 0.
- **Window W:** `policy.priceAdjustDays` when stated, else 14 days from `placedAt`; skipped once `now > placedAt + W`.
- **Current price:** `latestPrice(feed, merchant, sku, now)`, the latest observation at or before `now` for the same
  merchant (case-insensitive) and exact SKU; same-instant ties take the lowest price. Must be in the order currency.
- **Fires** when `(unitPrice − current) × heldQty ≥ max($5, 5% × unitPrice × heldQty)`. Amount = the drop, rounded to
  cents; `dueAt = placedAt + W`.
- Observations from the mock feed set `simulated: true` and add the evidence quote "Simulated price feed: … observed
  …" (message id `price-feed`).

## 5. Privacy boundaries

| Data | Where it goes |
|---|---|
| Raw email (headers, body, html) | Read in memory by prefilter, classify and redact. Never stored, never sent to an LLM |
| Extraction prompt to Claude | Only `Sender domain`, `Email date`, the redacted `Subject` and the redacted body (`buildExtractionPrompt`). No From/To addresses, no html |
| Claim rephrase prompt to Claude (optional) | The template body without the signature (so no customer name) and the list of facts it cites |
| `textHash` | Used by the cache and `FixtureLlmClient`; never sent to the provider |
| Stored per session | Extractions (fields, confidence, evidence quotes ≤200 chars from the redacted text), orders, findings, drafts, review queue, audit log |
| Audit `llm_call` rows | Model, input/output token counts or "cache hit", number of redacted tokens, email id. Never email text |
| OAuth tokens | Sealed with AES-256-GCM (`AUTH_ENCRYPTION_KEY`) in the SQLite `user` table; scope `gmail.readonly` only |
| API key | Read from `ANTHROPIC_API_KEY` at runtime and placed only in the `x-api-key` header; error messages never include it |

The matcher receives the redacted email, so evidence quotes and anything derived from them cannot carry unredacted
PII. Gold-label extractions in demo mode are also built from the redacted email.

## 6. Caching

- Interface `ExtractionCache { get(textHash), set(textHash, extraction) }` in `src/lib/ingestion/cache.ts`.
- Key: `textHash = sha256(redacted text)`. Identical redacted text never triggers a second LLM call; reruns and demo
  mode are free and offline.
- Only `ExtractionSchema`-valid results are cached. The file cache ignores entries that no longer validate and
  re-extracts them on demand.
- `createMemoryCache()`: the session cache held by the store, used for uploads, purged by delete-all.
- `createFileCache(path)`: JSON `{ [textHash]: Extraction }`, loaded lazily, rewritten on every `set`.
- `seed/llm-cache.json` (recorded real LLM output for the seed) is read-only for demo mode and is the fallback layer
  for uploads; it is not committed yet, so demo mode currently uses gold labels.
- A cache hit keeps the cached fields but takes the class from the current classifier.

## 7. In progress

- **#3** Gmail OAuth is on `main`; message sync through `runPipeline` and the delete-all revoke hook are not.
- **#35** Claims API routes (draft, edit, approve).
- **#34** Dev playground (`npm run playground`) and `docs/manual-test-plan.md`.
- **#22** Playwright e2e of the demo path.
- **#18** Rewards (L3), including the `rewards_gap` finding kind.
