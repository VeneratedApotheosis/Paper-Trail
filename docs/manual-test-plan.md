# Manual test plan (dev playground, issue #34)

The dev playground (`tools/playground/`) exercises every backend feature end to end without the product UI (which is
being redesigned in Paper). It is a dev tool: plain HTML/JS served by a tiny Node server that proxies `/api/*` to the
Next dev server. **All data is synthetic** (seed inbox and `tools/playground/edge-cases/*.eml`); the price feed is
simulated and labeled as such.

## Start

**Quickest (one command, issues #41/#99; `npm run demo` is an old alias):**
```powershell
npm run qa           # starts Next + playground, preloads the synthetic demo, opens your browser
npm run qa -- --no-open     # same, without opening a browser; Ctrl+C stops everything
```
It reuses a PaperTrail dev server already on port 3000, picks a free playground port (prints the URL), and
loads the demo so the Ledger tab has data immediately.

Manual alternative:
```powershell
npm run dev          # terminal 1: Next on http://localhost:3000
npm run playground   # terminal 2: playground on http://localhost:4000
```

Open http://localhost:4000. The dark banner at the top must say *"Dev playground. Demo data is synthetic. Simulated
prices are labeled."* and show the Claude status (key configured or not; the key itself is never shown).

- If Next is not running, the playground terminal prints a warning and every API call shows
  *"The Next dev server is not reachable…"*.
- Other ports: `$env:PT_PLAYGROUND_PORT='4100'; $env:PT_API_BASE='http://localhost:3001'; npm run playground`.
- The in-memory store resets when the Next server restarts.

Automated coverage behind this plan: `npx vitest run tools src/app/api` (edge-case pack, JSON API, debug routes).

## Global bugs (any tab)

Report as a bug if, anywhere:

- anything tries to **send email** or move money (the only hand-offs are Copy and a `mailto:` link);
- a full card number, phone number or street address appears in redacted text, LLM input, audit details or a stored
  field;
- demo data is not labeled synthetic, or a finding with `simulated: true` has no simulated label;
- a number in a finding/claim was produced by the LLM rather than by a rule (claims must only cite finding/order
  values);
- the API key appears in any response, page or terminal output.

## 1. Ledger tab

| # | Steps | Expected | Bug if |
|---|---|---|---|
| L1 | Click **Load demo** | mode `demo`; notice "Demo data — synthetic"; when no `seed/llm-cache.json` exists, a notice "Precomputed extractions (seed gold labels, no LLM)"; pipeline stats line; orders table filled | no synthetic notice; empty ledger; error |
| L2 | Read the summary | "You're owed" total, findings counted, excluded (needs review) count + amount; green ✓ "owed total = open findings on confirmed orders" | ✗ check shows; a needs-review order's finding counted in the total |
| L3 | Scan the orders table | merchant, ref, placed date, total + currency, status = latest event (`ordered` if none), needs-review badge, confMin | status not matching the latest event; CAD order shown as USD |
| L4 | Open **Why?** on each finding | summary, rule version, dates list, source quote, confidence, evidence quotes (message id + quote ≤200 chars), raw explain JSON | missing evidence; amount differs from explain values; confidence < 0.7 not flagged |
| L5 | Find a price-drop finding | purple "Simulated price feed" badge, "Simulated: yes" in Why? | simulated finding without label |
| L6 | **Exclude merchant** on an order | merchant disappears from orders, findings, review queue and the owed total; listed under Excluded merchants; ✓ "no excluded merchant in the ledger" | excluded merchant still counted or listed |
| L7 | **Include again** | merchant's orders/findings return, total restored | data lost after re-include |
| L8 | Needs review section | items with email id, stage (`classify` / `extract` / `match`), reason, order id | low-confidence item silently missing (never dropped: rule 5) |
| L9 | **Reset demo** | mode `empty`, everything cleared, audit log kept | data remains |
| L10 | Upload something, then **Reset demo** | HTTP 409 shown verbatim ("use POST /api/delete-all instead") | upload data silently wiped |

## 2. Upload tab

| # | Steps | Expected | Bug if |
|---|---|---|---|
| U1 | Upload `01-plain-order.eml` + `22-duplicate-confirmation.eml` | mode `upload`; file table (1 email each); without a key the orders land in the review queue (extraction failed: no key); with a key one order NW-2041, not two | two orders for one ref (dedup) |
| U2 | Upload all edge cases | prefiltered-out count includes `08`, `09`, `28`; phishing `06` never becomes an order | phishing or promo becomes an order |
| U3 | Upload a `.txt` file | HTTP 400 "Unsupported file type" shown verbatim | upload accepted |
| U4 | Upload an `.eml` with no Date header | 400 "No parseable emails" + details listing the reason | crash / generic error |
| U5 | Upload a `.mbox` with several messages | one row per file, `emails` = message count; parse errors listed per index | messages silently dropped |
| U6 | After U1, open the Trust tab audit log | `sync_start` / `sync_complete` rows (and `llm_call` rows with a key) | no audit rows |

## 3. Email lab

Pick an edge case from the dropdown (or paste a raw email), choose the rules "now", click **Run pipeline**.
Edge cases show an **X-PT-Expect vs actual** table: every row should say *pass* except the known bugs below.

| # | Steps | Expected | Bug if |
|---|---|---|---|
| E1 | Run `02-order-full-pan.eml` | redaction `pan 1`, body shows highlighted `[PAN_1]`, no `4242 4242 4242 4242` anywhere in the redacted text | card number survives |
| E2 | Run `03-phone-address-redaction.eml` | `[PHONE_1]`, `[ADDRESS_1]`; tracking number untouched | phone/address missed; tracking number redacted |
| E3 | Run `29-order-number-not-phone.eml` | only `555-0142` becomes `[PHONE_1]`; order `112-4455-6677` intact | order number redacted |
| E4 | Run `06-phishing-lookalike.eml` | class `not_receipt`, reason "phishing look-alike"; extraction "class not_receipt is never extracted" even with Claude ticked | phishing classified as a receipt |
| E5 | Run `07`, `08`, `09`, `28` | marketing (or not_receipt for 28); 08/09/28 dropped by the prefilter | promo becomes order (07 is a known bug) |
| E6 | Run any receipt without ticking Claude | extraction "Skipped: live extraction is opt-in…"; stage 6 "Not run" | an LLM call happens without opt-in |
| E7 | Run `23-html-only.eml`, `24-quoted-printable.eml`, `25-base64-body.eml`, `05-spanish-receipt.eml` | decoded body readable (HTML stripped, soft breaks joined, base64 decoded, accents and `ñ` intact) | mojibake / raw `=E2=80` / base64 text |
| E8 | Run `26-empty-body.eml` and `27-extremely-long-body.eml` | empty body handled; long body processed, trailing phone redacted | crash, timeout or missed phone |
| E9 | Paste text with no `Date:` header | 400 "Could not parse the email: missing or unparseable Date header" | crash |
| E10 | Lifecycle files `10`–`19` | class matches the file name (see table below) | wrong class |

## 4. Claims tab

Ledger findings use the real claims API (`/api/claims/:findingId`, #35): **Open draft** (GET), **Regenerate with
these options** (POST), **Save edits** (PUT), **Approve** (POST `/approve`). Findings produced in the Email lab are
not in the store and are drafted by `/api/debug/claim` instead (no approval record). "Draft claim" on a finding card
opens it here.

| # | Steps | Expected | Bug if |
|---|---|---|---|
| C1 | Load the demo, pick a `refund_overdue` finding, **Open draft** | subject + editable body; "not approved" badge; recipient with "guessed: confirm" badge; facts table all "yes"; ✓ "body cites the finding amount" | amount/date/order ref differs from the finding; a fact MISSING; ✗ check |
| C2 | Enter a support email, **Regenerate** | recipient = that address, "verified" badge; edits and approval discarded | guessed address still used |
| C3 | Open a price-drop finding | warning "Price comes from a simulated feed; verify…" | no simulated warning |
| C4 | Open a return-deadline finding | note suggesting the store's website return flow | — |
| C5 | Change the amount in the body, **Save edits** | "edited" badge; warning "Edited body no longer contains: …"; facts row MISSING; approval cleared | edit accepted silently |
| C6 | **Approve** | "approved <time>" badge; Copy + Open mailto appear; finding status becomes `drafted` on the Ledger tab; `approval` audit row (no subject/body in it) | hand-off available before approval; audit row contains the email text |
| C7 | **Copy**, then **Open mailto** | clipboard holds `Subject: …` + body; your mail client opens a pre-filled draft; nothing is sent by PaperTrail | anything sent automatically |
| C8 | Enter a profile name, Regenerate a finding whose order has no customer name | body signed with the profile name | signed "Customer" despite a profile name |
| C9 | Invalid support email (`abc`), Regenerate | HTTP 400 with validation details | accepted |
| C10 | Email lab finding (run with Claude, see Live Claude test) → Draft claim | "lab" badge, Copy/mailto immediately, "not stored" note | — |
| C11 | Exclude the finding's merchant, then Open draft | HTTP 404 "Finding not found" | draft for an excluded merchant |

## 5. Trust & eval tab

| # | Steps | Expected | Bug if |
|---|---|---|---|
| T1 | **Refresh audit log** after loading the demo | `sync_start`, `llm_call` rows (model `gold`, "Precomputed extraction…, no LLM call"), `sync_complete`; PII-token counts, no email text | email text in details; LLM call without audit row |
| T2 | **Delete everything…** → confirm | result shows deleted/ok, time, OAuth revoked flag, purged counts; ✓ "everything is gone"; ledger tab shows mode `empty`, no orders/findings/review items/exclusions; audit log has only the `delete` row | anything remains (✗ check) |
| T3 | **Run eval** | synthetic report: gate table (all PASS), classifier accuracy/macro F1 per split (all/dev/holdout), phishing-as-order count, finding precision/recall for oracle-extraction and realistic-routing, misses listed | any gate FAIL; phishing-as-order > 0; oracle mode not 100% |

All four gate rows should PASS (same thresholds as `src/lib/eval/gate.test.ts`); a FAIL is a regression.

## Edge-case files mapped to features

Full descriptions: [`tools/playground/edge-cases/README.md`](../tools/playground/edge-cases/README.md).

| Feature | Files |
|---|---|
| Prefilter keep/drop | all; dropped: `08`, `09`, `28` |
| Redaction: card number | `02` |
| Redaction: phone / address | `03`, `27` (phone at the end of a ~90 KB body), `29` (order number must survive) |
| Redaction: email address | `04` (inner From of a forward) |
| Forwarded mail | `04` |
| Non-English | `05` (Spanish, RFC 2047 subject) |
| Phishing look-alike | `06` |
| Marketing vs receipt | `07` (known bug), `08`, `09`, `28` |
| Lifecycle classes | `01` order, `10` shipped, `11` delivered, `12` return started, `13` return dropped off, `14` return received, `15` refund, `16` short refund, `17` store credit, `18` cancel, `19` price adjustment |
| Multi-currency | `20` (CAD), `21` (EUR) |
| Dedup / matcher | `01` + `22` (same order ref) |
| MIME decoding | `23` (HTML only), `24` (quoted-printable), `25` (base64), `05` (8-bit UTF-8) |
| Degenerate input | `26` (empty body), `27` (very long body) |

Known classifier bug (marked `it.fails` in `tools/playground/edge-cases.test.ts`; remove the entry once fixed):

- `07-promo-with-order-number.eml` is classified `order`: a labeled order ref disables the promo check and "Thanks for
  your order" in the body wins, so a promo would be extracted and could become a ledger row.

## Live Claude test (opt-in, costs tokens)

1. Put `ANTHROPIC_API_KEY=...` in `.env.local` (optional `LLM_MODEL`; never commit it), restart `npm run dev`.
2. Reload the playground: banner shows "Claude key configured (model)"; the **Use Claude** and **Rephrase with
   Claude** checkboxes become enabled.
3. Email lab: tick **Use Claude**, run `01-plain-order.eml`. Expected: extraction table with per-field confidence and
   evidence quotes, confMin, model; one `llm_call` audit row (also visible on the Trust tab) with token counts and
   PII-token count; stage 6 shows the matched order and any findings at the chosen "now" (e.g. set now to
   2026-10-27 for a return-deadline finding).
4. Run the same email again: extraction `cached: yes`, audit row says "cache hit, no LLM call".
5. Run `02-order-full-pan.eml` with Claude: evidence quotes contain `[PAN_1]`, never the card number.
6. Run `06-phishing-lookalike.eml` with Claude ticked: still skipped, no audit row (no tokens spent).
7. Claims: tick **Rephrase with Claude**, click **Regenerate with these options** on a ledger finding. Expected: either "Rephrased by Claude (fact-checked)" with all
   facts still verbatim, or "Rephrase not used: …" with the template body. A rephrased body with a changed amount or
   a new number is a bug.
8. Upload: with a key, uploading `01` + `22` produces one confirmed order NW-2041 instead of review-queue items.
9. Trust tab → **Delete everything** also purges the session extraction cache: rerunning step 3 makes a fresh call.

Bug if: an LLM call happens without the checkbox, the key appears anywhere, raw PII reaches the LLM (check evidence
quotes), an LLM call has no audit row, or invalid LLM output is dropped instead of shown as "Needs review".
