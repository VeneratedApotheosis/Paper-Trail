# Purchase kinds, shipments and grouped tracking emails (#127)

Every order has a `kind` and matching `details` (both optional on older data: read as `"other"`). Tracking emails
(shipped, out for delivery, ready for pickup, delivered) join the purchase they belong to as one timeline. Code:
`src/lib/orders/{kind,shipments,matcher}.ts`, `src/lib/ingestion/carriers.ts`, contract in `src/lib/contracts/{purchase,orders,extraction}.ts`.

## Contract (additive)
- `PurchaseKind`: `shipped | in_store | digital | subscription | food_delivery | travel | other`.
- `PurchaseDetails` is a union keyed by `kind` (shipped: `shipments[]`; in_store: `location`; digital: `platform`;
  subscription: `plan`, `interval`, `nextRenewal`; food_delivery: `restaurant`, `deliveredAt`; travel: `segments[]`,
  `confirmation`; other: nothing).
- `Shipment`: `carrier`, `trackingNumber`, `trackingUrl`, `status`, `eta`, `shippedAt`, `deliveredAt`, `itemIds` and
  `pickupLocation` (additive). `ShipmentStatus`: `ordered | shipped | out_for_delivery | ready_for_pickup | delivered | returned | unknown`.
- `OrderEventType` gains `placed` (the confirmation), `out_for_delivery`, `ready_for_pickup`. Every confirmed order now
  starts its timeline with `placed` at the order date.
- `NormalizedOrder.packageOnly`: tracking emails with no receipt (see below).
- Extraction (`fields`, unscored like `otherRefs`): `kindGuess`, `shipment { carrier, trackingNumbers[], status, eta,
  pickupLocation }`, `subscription`, `travel`, `restaurant`, `platform`, `storeLocation`. Malformed details are repaired or
  dropped (never fail the extraction); the primary fields keep the retry-once rule.

## Kind rules (first match wins)
1. Merchant/domain tables: food delivery (DoorDash, Uber Eats, Foodpanda, ...), travel (airlines, hotels, rail, Airbnb, ...).
2. Shipping evidence (a shipped/delivered email, a tracking number or a shipment status) -> `shipped`.
3. Recurring billing -> `subscription`: renewal wording (EN/ZH), an LLM interval, or the same merchant + total again 20-45 days apart.
4. App stores and game platforms -> `digital` (platform from the table).
5. Convenience stores, coffee/fast-food chains, POS platforms -> `in_store`.
6. The LLM's `kindGuess`, only when the order's extraction confidence is >= 0.7; otherwise `other`.

## Tracking numbers and URLs
Numbers come from the email text (labelled "Tracking number", 物流單號, 追蹤編號, 查貨號碼, 取貨編號, ...; UPS `1Z...`, USPS 92-95..., Amazon `TBA...`; tracking-link
parameters) plus the LLM's numbers, but only those that appear in the text. Normalized: upper case, no spaces/hyphens.
`trackingUrl` is built by code: UPS `ups.com/track?tracknum=`, USPS `tools.usps.com/go/TrackConfirmAction?tLabels=`, FedEx
`fedex.com/fedextrack/?trknbr=`, DHL `dhl.com/.../tracking-express.html?tracking-id=`, Amazon `track.amazon.com/tracking/`,
T-cat `t-cat.com.tw/Inquire/TraceDetail.aspx?BillID=`, 7-ELEVEN `eservice.7-11.com.tw/e-tracking/search.aspx?shipNum=`.
HCT, Chunghwa Post, FamilyMart, Hi-Life, Shopee: no public direct-link pattern -> `null`.

## Status
Per email: the `delivered` class (also a pickup) is `delivered`; otherwise wording (ready for pickup / 已到店 / 可取貨, out for
delivery / 配送中, returned to sender, in transit / 已出貨 / 運送中), then the LLM, else `shipped`. A shipment never moves
backwards: the most advanced status wins, equal ranks go to the later email. Emails without a number apply to the order's
only shipment. Itemized split shipments keep `itemIds` per package.

## Linking (dedup, `docs/dedup.md`)
Order of evidence: Message-ID/fingerprint -> order reference (incl. `otherRefs`, subject refs) -> **shared tracking number**
(merge reason `tracking_number`; joins merchant, carrier, marketplace and convenience-store emails whatever the sender, and
outranks a differing reference because shipment ids are often printed as order numbers; never joins two confirmations, only
`shipped`/`delivered` emails, blocked by a currency conflict) -> the #126 scored fallback. A tracking number printed as the
order reference is not treated as a reference. Lifecycle-only clusters (e.g. merchant email + carrier email joined by a
tracking number) are scored against the merchant's confirmations as a whole, so a receipt that arrives later absorbs them.

## Package-only entries
Shipped/delivered emails with no confirmation form ONE entry per package: `kind: shipped`, `packageOnly: true`, total 0, no
line-item prices, no findings, never in owed totals, `needsReview: false` unless the matcher found a conflict. Merchant name:
the shop if any email names it, else the marketplace/carrier. Id `order:<merchant>:pkg-<tracking number>`. A later receipt
(same inbox on the next sync, or another linked inbox through `mergeSameOrder`) absorbs it: shipments union by tracking
number, the flag disappears. Food-delivery and travel merchants never produce package entries.

## Quality report
`SyncQualityReport.lifecycle { linked, orphaned }` (shipping emails in an order with a receipt vs in a package-only entry),
`kinds` (orders by kind), `mergesByReason.tracking_number`. Also on `PipelineStats`.

## Classifier
Tracking wording (English + Traditional Chinese: 已出貨, 出貨通知, 配送中, 運送中, 已到店, 到店通知, 可取貨, 待取貨, 已取貨, 已送達, 已簽收, arriving today, label created,
delivery attempted, ready for pickup, ...) is class `shipped`/`delivered`, never an order. Known carrier/convenience-store/marketplace sender
domains are trusted for the name/domain match; a display name that claims a carrier on another domain is suspicious (fake
tracking mail -> `not_receipt`). The Gmail query and the upload prefilter include the new terms.
