# Seed data (synthetic)

**Everything in this folder is synthetic.** The stores, people, orders, addresses, phone numbers and card numbers
are invented for the PaperTrail demo and tests. No real email, person or company is represented.

- Stores are fictional and use reserved `.example` domains: Bazaarly (marketplace), Grandmart (big-box),
  Voltline Electronics (electronics), Northwind Outfitters (apparel), Lumen Beauty (beauty), Oakhaven Home
  (furniture), FreshCart Grocery (grocery), Brewbox Coffee (DTC subscription).
- The customer is the fictional "Sam Rivera". Phones use the reserved `555-01xx` range, addresses are made up, and
  the full card numbers that appear (to exercise redaction) are public Luhn-valid test numbers
  (`4242 4242 4242 4242`, `4000 0566 5566 5556`, `5555 5555 5555 4444`).
- `price-feed.json` is a **simulated** price feed (`"simulated": true`); the UI must label it "simulated".
- The phishing email from `n0rthwind-support.example` is a deliberate lookalike and must never become an order.

## Files

| File | Contract (`@/lib/contracts`) | Contents |
|---|---|---|
| `inbox.json` | `SeedInbox` | 78 `RawEmail`s, `asOf` = `2026-10-17T19:00:00Z` (the fixed "now" for rules and eval) |
| `gold_labels.json` | `GoldLabelsFile` | class + expected extracted fields + edge-case tags for every email; 15 `holdout: true` |
| `expected_findings.json` | `ExpectedFindingsFile` | ground truth at `asOf`: 4 `refund_overdue`, 2 `refund_short`, 5 `return_deadline`, 3 `price_drop`, each with a note showing the math |
| `price-feed.json` | local (`PriceFeed` in `scripts/generate-seed.ts`) | `{ simulated, observations: [{ merchant, sku, name, price, currency, observedAt }] }` |
| `templates/` | — | per-store email templates (TypeScript) and the shared plain-text renderer |

Edge cases are tagged in `gold_labels.json` (`tags`): `partial_return`, `split_shipment`, `store_credit`,
`short_refund`, `multi_currency` (CAD), `forwarded`, `non_english` (Spanish), `phishing_lookalike`,
`marketing_not_order`, `duplicate_order` / `updated_order`, `final_sale`, `cancel_before_ship`,
`subscription_renewal`, `refund_without_return`, `refund_pending_not_due`, `refund_matched`, `price_drop_promo`.

## Rule semantics behind `expected_findings.json`

Days are 24h UTC periods; `dueDate` is the UTC date of the due time; money is rounded to cents.

- **R1 refund**: trigger T = `return_received` (strong) else `return_started`/`return_dropped` (weak). SLA N = days
  stated in the email, else 10 (strong) / 14 (weak). Expected = returned items + prorated tax (whole order = order
  total). A `refund`/store credit at or after T matches. Overdue if now > T + N with no match; short if the matched
  refund < expected − max($0.50, 2%).
- **R2 return deadline**: anchor = delivered date when the policy says "of delivery" (and a delivery email exists),
  else the order date; window from the email, else 30. Fires when the deadline is 0–7 days after now, no return
  events exist, and the order is not final sale. Amount = order total.
- **R3 price drop**: per line item, within `priceAdjustDays` (else 14) of the order date, using the latest feed price
  observed at or before now; fires when the drop ≥ max($5, 5% of the line total).

`scripts/seed.test.ts` re-implements these rules independently and checks that they produce exactly the expected
findings and that no other seed order fires.

## Regenerate

The generator (`scripts/generate-seed.ts`, `buildSeed()`) is deterministic: no randomness, no clock, no network.

```powershell
$env:WRITE_SEED='1'; npx vitest run scripts/write-seed.test.ts   # rewrite the JSON files
Remove-Item Env:WRITE_SEED; npx vitest run scripts              # verify files match buildSeed() + validate
```

Without `WRITE_SEED=1`, `scripts/write-seed.test.ts` fails if the committed JSON differs from `buildSeed()` output.
