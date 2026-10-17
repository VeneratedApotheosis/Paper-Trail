# Edge-case emails (synthetic)

**Every file here is synthetic.** Stores are fictional and use reserved `.example` domains, the customer is the
fictional "Sam Rivera", phones use the reserved `555-01xx` range, addresses are made up, and the only full card number
is the public Luhn-valid test number `4242 4242 4242 4242`.

Use them in the playground's **Email lab** (dropdown) or upload them on the **Upload** tab. `edge-cases.test.ts`
(in `tools/playground/`) checks each file automatically with `npx vitest run tools`.

## `X-PT-Expect` header

Each file states what should happen, e.g. `X-PT-Expect: class=refund; keep=true; redacts=pan,phone`.

| Key | Meaning |
|---|---|
| `class` | Expected `classify()` label. `a\|b` accepts either (e.g. a newsletter may be `marketing` or `not_receipt`). |
| `keep` | Expected `isReceiptLike()` decision (the prefilter uploads use). |
| `redacts` | Redaction kinds (`pan`, `phone`, `address`, `email`) that must be replaced; every other kind must stay at 0. `none` = nothing. |
| `contains` | Optional text the parsed plain-text body must contain (checks base64 / quoted-printable / HTML decoding). |

Known classifier bugs are marked `it.fails` in the test (see `KNOWN_FAILURES` there) and are listed below as
**known bug**. Once a bug is fixed in `src/lib/ingestion`, remove its entry so the test enforces the expectation.

## Files

| File | Tests | Expectation |
|---|---|---|
| `01-plain-order.eml` | Plain order confirmation with line items, totals, last-4 and a stated return policy | order, kept, nothing redacted (last-4 is allowed) |
| `02-order-full-pan.eml` | Full test card number in the body | order, `[PAN_1]` replaces the card number |
| `03-phone-address-redaction.eml` | Ship-to street address + support phone; tracking number must survive | shipped, phone + address redacted |
| `04-forwarded-receipt.eml` | Receipt forwarded by the user ("Fwd:", inner From/Subject block) | order (from the inner message), inner sender email redacted |
| `05-spanish-receipt.eml` | Spanish receipt, RFC 2047 encoded subject, 8-bit UTF-8 body | order, decoded body contains "Gracias por tu compra" |
| `06-phishing-lookalike.eml` | `n0rthwind-support.example` look-alike asking to verify a card | `not_receipt` (must never become an order) |
| `07-promo-with-order-number.eml` | Promo that mentions a past order number ("Thanks for your order #LB-60111! 20% off") | marketing. **Known bug:** classified as order |
| `08-promo-price-drop.eml` | "Prices just dropped" promo from a deals@ sender | marketing, dropped by the prefilter |
| `09-promo-on-its-way.eml` | "Deals are on their way" promo (shipping wording, no order) | marketing, dropped by the prefilter |
| `10-shipped.eml` | Real shipping notice ("on its way" + tracking number) | shipped |
| `11-delivered.eml` | Delivered notice with a delivery-anchored return window | delivered |
| `12-return-started.eml` | Return approved, label attached | return_started |
| `13-return-dropped-off.eml` | "Your return for order ... was dropped off" | return_started (matcher turns it into `return_dropped`); was misrouted to shipped before #33 |
| `14-return-received.eml` | Return received, refund SLA stated (10 days) | return_received |
| `15-refund.eml` | Full refund issued to card ending 4242 | refund |
| `16-short-refund.eml` | Refund smaller than the returned item's price (R1 short refund) | refund |
| `17-store-credit.eml` | Refund as store credit instead of to the card | refund |
| `18-cancel.eml` | Order cancelled before packing | cancel |
| `19-price-adjustment.eml` | Merchant-issued price adjustment | price_adjust |
| `20-multi-currency-cad.eml` | Totals in CA$ (CAD) | order, body contains "CA$" |
| `21-multi-currency-eur.eml` | Totals in € with comma decimals (EUR) | order |
| `22-duplicate-confirmation.eml` | Second ("updated") confirmation for the same order as `01` | order; uploading 01 + 22 must yield one order |
| `23-html-only.eml` | `multipart/alternative` with only a `text/html` part | order, HTML converted to text containing "Order total" |
| `24-quoted-printable.eml` | Quoted-printable body with soft line breaks and an encoded em dash | shipped, soft breaks joined |
| `25-base64-body.eml` | Base64-encoded `text/plain` body | refund, decoded body contains the refund sentence |
| `26-empty-body.eml` | Receipt subject with an empty body | order (from the subject alone); extraction should land in needs-review, never a guessed total |
| `27-extremely-long-body.eml` | ~90 KB body with a phone number at the very end | order, the trailing phone is still redacted |
| `28-newsletter.eml` | Non-receipt newsletter | marketing or not_receipt, dropped by the prefilter |
| `29-order-number-not-phone.eml` | Order number shaped like digits (`112-4455-6677`) next to a real phone | order, only the phone is redacted |
