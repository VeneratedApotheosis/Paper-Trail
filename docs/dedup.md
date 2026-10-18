# Duplicate handling (#126, Phase 1)

Several emails about one purchase must become ONE order (no double-counted owed findings); repeat purchases and
subscriptions stay separate. Code: `src/lib/orders/dedup/` (pure, deterministic), used by `matchOrders`, the pipeline
and `mergeAccountResults`.

## A. Exact copies, before extraction (`exact.ts`)
- `RawEmail.messageId` = RFC 5322 `Message-ID` (Gmail `payload.headers`, `.eml`/mbox headers), brackets stripped.
- The pipeline collapses an email into an earlier one (no LLM call) when it has the same Message-ID and class, or an
  identical body fingerprint (sender domain + subject without `Fwd:`/`Re:` + whitespace-normalized text) within 24 h
  **seen through another linked inbox**. Identical text in one inbox with different Message-IDs is never collapsed
  (two identical coffee receipts look alike). Two different Message-IDs are never a copy.
- The survivor's order keeps every copy's Gmail id (`messageIds`) and account (`sources`), and `emailKeys`
  (`mid:<id>`, `fp:<hash>`). Gmail runs are per account, so across accounts the same decision is taken on `emailKeys`
  when ledgers merge (the extraction cache already spares the second LLM call for identical text).

## B. Keys (`merchant.ts`, `refs.ts`)
- Merchant identity = a SET of keys: `alias:<id>` (alias table: amazon, apple, ebay, walmart, target, bestbuy,
  aliexpress), `dom:<registrable domain>` of the sender (ignored for forwards, mailbox providers and commerce
  platforms such as Shopify/Shopline) and of the extracted domain, `name:<slug>` (corporate suffixes and `.com`
  dropped; for platform senders the display name is the shop). Same merchant = key sets intersect.
- Order refs are canonicalized (case, `#`, spaces/dashes, label words ORDER/INV/WEB/..., leading zeros). Extraction
  returns `fields.otherRefs` (all other reference numbers, Zod-validated, cleaned: trim, dedupe, <= 10 of <= 64
  chars; not a scored field). Refs named in the SUBJECT (`order #BLK-9129`) count too, even when the LLM returned a
  shipment id or nothing. Emails sharing any strong ref (>= 4 chars with a digit, or equal primary refs) join (union-find).

## C. Scored matching (`score.ts`, `cluster.ts`)
Weights (`DEDUP_WEIGHTS`): exact copy 100, shared ref 70, merchant 10, amount exact 25 / close 12, items shared
(lifecycle 40/25/10, confirmation 30/18/8), thread (lifecycle 30, confirmation 10), date gap, exact amount within 3 d +15.
Thresholds: `AUTO_MERGE_SCORE` 60, `POSSIBLE_DUPLICATE_SCORE` 35, lifecycle ambiguity margin 10.
- Two confirmations merge only on an exact copy or a shared ref (or one lost its number: same everything within 3 days).
- Middle band => `NormalizedOrder.possibleDuplicateOf { orderId, reason, score }` on the later order; counted as its own
  purchase; no UI yet.
- Hard constraints (block whatever the score): different order refs on two confirmations; same total again >= 20 days
  apart (recurring charge); different merchants/currencies; lifecycle email naming another order; refund above the
  order total (by items/amount); event dated before the order; outside the window. A summary email naming two orders
  cannot chain them (cluster-level check).
- A bare lifecycle email (no ref, items or amount) joins the merchant's only order inside its window (`only_order`).

## E. Lifecycle windows
shipped/delivered attach within 30 days; refund/return/price-adjust/cancel within 90, by ref or by items + amount.
A refund above the total that names the order attaches but the order goes to review with a reason.

## Ids and corrections
An order keeps the id the earliest ref-bearing email would have had before (`order:<name slug>:<ref slug>`); a repeat
id (subscription months) gets `:2`, `:3`. Ids of merged-away orders are `aliasIds`; Review corrections saved under them
(including line-item and finding ids) are re-keyed in `applyOverrides`.

## Measure (`dedup-eval.ts`, test `dedup-eval.test.ts`)
Pairwise precision/recall of "same purchase" over 50 synthetic emails (fixtures in `dedup-fixtures.ts`).
"Before" = legacy grouping (`matchOrders(..., { legacyGrouping: true })`) per inbox, inboxes joined by identical id.
All 50 emails: before P 0.667 / R 0.333 (10 TP, 5 FP, 20 FN); after P 1.000 / R 1.000 (30 TP).
Per scenario before -> after recall: name variants, invoice/confirmation numbers, forwarded copy with another spelling,
same email in two inboxes, late delivery, refund 3 weeks later, Shopify sequence, bare lifecycle email 0 -> 1;
precision: two identical coffees, monthly subscription, refund above total 0 -> 1. Quality report fields:
`duplicatesCollapsed`, `mergesByReason` (message_id, fingerprint, shared_ref, thread, items_amount, only_order),
`possibleDuplicates`; also `PipelineStats.dedup`.

## Known limits / Phase 2
- A receipt re-sent >= 20 days later with the same total counts as a second purchase.
- Delivery/refund beyond the window without a ref stays its own (review) order.
- Refless identical receipts are only flagged; "This is a receipt" single-email adds are not deduplicated.
- Phase 2: Review "Possible duplicates" card (merge / not a duplicate, remembered), payment-service receipts (PayPal,
  Stripe) as evidence, learned thresholds, merging lifecycle-only groups with each other.
