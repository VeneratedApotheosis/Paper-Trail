# Human review backend (#47, backend half of #11)

All routes select the same authenticated account store as the ledger API. Anonymous synthetic demo review remains available in its separate store. Invalid/deleted auth sessions return 401; orders from another account and excluded merchants are unavailable. Responses use `Cache-Control: no-store`. The UI wiring belongs to Alex; this backend task does not edit page or component files.

## Routes

- `GET /api/review` returns `{ orders: NormalizedOrder[], items: ReviewQueueItem[] }`. `orders` contains orders that currently need review. `items` also preserves unresolved classification/extraction items without an order; these cannot be confirmed through an order endpoint.
- `POST /api/review/:id/edit` accepts `{ revision, edit }`.
- `POST /api/review/:id/confirm` accepts `{ revision, confirmed: true }`.

The two POST routes return `{ ok: true, order, findings, revision, summary }`. `summary` is the existing backend ledger summary (rounded to cents). Use `encodeURIComponent(order.id)` in URLs.

`revision` is an opaque UUID from `order.review.revision`; never calculate it client-side. Every replacement sync/demo load and every edit issues a new revision. A stale request receives 409 and must reload current data rather than automatically retry an old confirmation. Repeating confirmation for the same confirmed revision is idempotent and does not add another audit entry.

Request schemas and the `ReviewEdit` type live in `src/lib/review/schema.ts` (Zod, no server imports), independent of frontend components.

## Corrections

The `edit` discriminated union supports:

| field | value | extra property |
|---|---|---|
| `merchantName`, `orderRef` | nonempty text, up to 200 characters | |
| `placedAt` | ISO datetime with offset | |
| `currency` | three uppercase currency letters | |
| `total` | nonnegative finite amount, at most two decimal places | |
| `subtotal`, `tax`, `shipping`, `discount` | same amount constraints, or null for unknown | |
| `lineItemName` | nonempty text, up to 200 characters | `lineItemId` |
| `lineItemQty` | positive integer, up to 100000 | `lineItemId` |
| `lineItemUnitPrice` | nonnegative finite amount, at most two decimal places | `lineItemId` |

Amounts are capped at 1 billion major currency units. A quantity cannot be lowered below its already-returned quantity. Unknown fields, extra properties, forged confidence/confirmation metadata, malformed JSON, and unsupported values are rejected. Corrections change only the named field: the backend does not guess changes to tax, discounts, or other amounts. The human confirms the current set of values; dependent subtotal/total fields can be corrected explicitly when necessary.

Editing always sets `needsReview: true`, clears the previous confirmation, and removes the order's stale findings/drafts. It remains out of owed totals until explicitly reconfirmed. Unknown or hidden orders/items return 404; invalid order invariants return 422; stale revisions or attempts to edit clean, never-reviewed orders return 409. Cross-origin POSTs return 403.

## Confirmation, confidence, and findings

Canonical `NormalizedOrder` adds optional `review: { revision: string, confirmedAt?: string }`. Review endpoints preserve the model's original `confMin`, event confidences, source IDs, and evidence quotes. They never replace them with an invented confidence score.

Confirmation sets `needsReview: false` and records `confirmedAt`. The shared `orderNeedsReview()` helper respects an explicit confirmation of low-confidence data; a remaining `needsReview: true` flag always holds the order out. Rules R1–R3 are rerun with the corrected order, and the resulting findings can enter totals. Only that order's findings/drafts are replaced; other orders and user statuses remain unchanged.

Demo review uses the original demo `asOf` and simulated seed price feed. Upload/Gmail review uses the injected/current clock and never substitutes seed prices. Source extraction cache entries are untouched; a later full sync creates a fresh snapshot and new review revisions rather than silently treating new extracted data as human-confirmed.

Each save/confirmation writes an audit entry using the existing `approval` event type, with `Review edit saved:` or `Review confirmed:` in `detail`. Corrections log order ID, field name, and revision, not entered text values or raw email bodies. Confirmation logs order ID/revision. No new frontend audit enum is required.

State follows the existing in-memory server store lifecycle: corrections/confirmations survive requests but not process restarts or replacement pipeline loads. Delete-all clears them with the order data. This is not durable database review storage.

## Verification

`npm run lint`, `npm run typecheck`, and `npm test` cover edit validation, source-confidence preservation, confirmation/totals, deterministic recomputation, stale drafts, stale revision conflicts, idempotence, account isolation, and excluded/unknown records. All fixtures are synthetic. No LLM or Gmail network calls are needed.
