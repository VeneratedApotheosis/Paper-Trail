# PaperTrail — Feature Scope (Receipt Ledger + Refunds + Rewards Manager)

> **Update 2026-10-17:** Devin / Cognition *Best Use of Devin* was **dropped** (see plan.md decision log). Targets are Paper + Visa (+ optional Sentry). Any "Devin ticket" below is just a work item, now done by the team and its own agents (pi, Codex, ...) coordinated via GitHub Issues.
Derived from plan.md (S14, locked constraints), deepdive_S14.md, brief.md. Software-only custom web app · targets Devin + Paper + Visa (optional Sentry). Scope doc only; not a decision record. Visa tags: **Inn**ovation · **UX** · **Tech** · **Imp**act · **Trust**. Priority: P0 must (demo breaks without) · P1 should · P2 nice. Effort: S ≤2h · M ≈2-6h · L >6h.

## 1. Product summary
**One-liner:** "Your inbox already knows what stores owe you. We collect it." Read-only Gmail → purchase ledger → one number: **"You're owed $X"** (stuck refunds + closing return windows + price drops), each with an evidence trail and a drafted claim the user approves.
**Headline hook (pick one to lead the pitch):** *explainable money recovery* — every dollar links to the source email quote + confidence. Trust-first (read-only, delete-all) is the supporting story.
**Persona:** none. PaperTrail itself is the persona: one calm, trustworthy assistant for whoever placed the order. No fictional user is used in the docs, UI copy or demo.
**Name:** **PaperTrail** (decided). Note: it contains the word "Paper", which is also a sponsor name, so keep branding/design clearly our own (a receipt-trail concept, not Paper-the-tool) and mention Paper only in the design-credit line.

## 2. Features
### Layer 1 — Core ledger + trust
- **F1.1 Gmail read-only connect** — *As a PaperTrail user I connect Gmail knowing it can only read.* AC: only `gmail.readonly` requested (PKCE+state) · consent explainer shows scope + "will not" list before Google redirect · token stored encrypted; re-consent path works when the 7-day Testing token expires · works for listed test users, clear error otherwise. **P0 · M · Backend · Trust, UX**
- **F1.2 Demo mode + fixture import** — *As a judge without access I use a seeded inbox.* AC: one click loads `seed/inbox.json` through the same pipeline as Gmail · `.eml/mbox` upload works · persistent "Demo data — synthetic" banner · full demo path runs offline from cached LLM output. **P0 · M · Ingestion · Tech, Trust**
- **F1.3 Prefilter, redact, classify** — *As a PaperTrail user I don't want non-receipt mail touched.* AC: Gmail query + sender/keyword filter shown to user · PANs/phones/street addresses replaced by tokens before any LLM call · classes: order, shipped, delivered, return_started, return_received, refund, price_adjust, cancel, marketing, not_receipt · marketing/phishing look-alikes are not turned into orders. **P0 · M · Ingestion · Trust, Tech**
- **F1.4 LLM structured extraction** — *As a PaperTrail user I get clean rows.* AC: schema-validated JSON (merchant, order_ref, date, currency, line items, totals, last4?, customer_name) · per-field confidence 0-1 + evidence snippet ≤200 chars · invalid output retried once then routed to review, never silently dropped · results cached by hash of redacted text. **P0 · L · Ingestion · Tech**
- **F1.5 Order matching + dedupe** — *As a PaperTrail user I see one order, not five emails.* AC: events grouped by order_ref, else merchant+amount+date proximity · duplicate/"updated order" confirmations merge, never double-count · out-of-order timestamps resolve to the right timeline. **P0 · M · Backend · Tech**
- **F1.6 Ledger timeline** — *As a PaperTrail user I see all purchases at a glance.* AC: reverse-chron list with merchant, total, status chip, source-email chip · filter by merchant/status · order detail shows event timeline (ordered→shipped→returned→refunded) with evidence quotes · loads <1s on 50 orders. **P0 · M · Frontend · UX**
- **F1.7 Needs-review queue** — *As a PaperTrail user I can fix what the AI isn't sure of.* AC: any order with min confidence <0.7 gets a "Needs review" badge and is excluded from "owed" totals until confirmed · inline edit of fields · edits logged to audit. **P0 · M · Frontend · Trust, UX**
- **F1.8 Trust page** — *As a wary user I verify what the app does.* AC: lists exactly what is read/stored/never done · audit log of every Gmail fetch, LLM call (redacted-token count), approval, delete · **Delete everything** revokes token, purges rows, shows confirmation receipt, ledger empties live · per-merchant exclude. **P0 · M · Backend+Frontend · Trust**
- **F1.9 Sync with preview** — *As a PaperTrail user I know what a sync will touch.* AC: shows message count + query before first run (capped 90 days / ≤300) · progress with stage names · 429 backoff, resumable · manual "Sync now" (no push). **P1 · S · Backend · Trust, UX**

### Layer 2 — Refunds, returns, price drops
- **F2.1 Refund tracker (R1)** — *I learn when a refund is overdue or short.* AC: return received/dropped + no matching refund after SLA ⇒ `refund_overdue` · refund < expected beyond tolerance ⇒ `refund_short` with delta · store credit where card was tender ⇒ flagged · rules are pure, versioned, clock-injected, table-tested against expected_findings. **P0 · M · Backend · Imp, Tech**
- **F2.2 Return deadlines (R2)** — *I never miss a window.* AC: deadline = anchor + window; precedence email-quote → policy table → "policy unknown" (no alert) · alerts at T-7/T-2/expired, suppressed once a return event exists · final-sale/gift-card items suppressed · window conf <0.7 shows "check policy" + quote. **P0 · M · Backend · Imp, Trust**
- **F2.3 Price-drop watcher (R3)** — *I get adjustments I'd otherwise miss.* AC: fires if drop ≥ max($5, 5%) inside adjustment window, same SKU, first-party seller · price source always labeled with observed-at (mock feed "simulated", or in-inbox promo email) · "fast-forward N days" demo control. **P0 · M · Backend · Imp, Inn**
- **F2.4 "You're owed $X" hero + explain-why** — *I see one number I can trust.* AC: total = sum of open findings with confidence ≥ threshold, split by kind · every card has "Why?" (rule, source quote, dates, confidence) · uncertain items shown separately as "maybe", never in total · count-up motion respects reduced-motion. **P0 · M · Frontend · UX, Trust, Imp**
- **F2.5 Claim draft + human approval** — *I send the claim in one tap.* AC: draft cites order ref, amounts, policy quote; numbers come from rules, LLM only writes wording · drafts are written in the voice of, and signed with, the name of the person who placed the order (`customer_name` from the receipt; falls back to the connected Google account name; user can edit before approving) · editable; "Approve" → copy / `mailto:` · nothing is ever sent by the app · approval + draft audited. **P0 · M · Backend+Frontend · UX, Trust**
- **F2.6 Finding lifecycle** — *I can dismiss or close items.* AC: open/drafted/resolved/dismissed · a later refund email auto-resolves ("refund already received") with the matching email shown · dismissed items stay out of totals and are restorable. **P1 · S · Backend · UX**
- **F2.7 Eval harness + /eval page** — *Judges see the AI is accurate.* AC: ≥30-email labeled set (≥8 merchant styles, ≥15 edge cases), ~15 held out · reports classification acc/macro-F1, per-field exact match, end-to-end finding precision/recall, % routed to review · baseline compare (regex vs LLM vs LLM+rules) · same table in README; CI gate on metrics. **P0 · L · QA+Ingestion · Tech, Trust**

### Layer 3 — Rewards (cut first, but see §7 stage-count note)
- **F3.1 Cards + missed-rewards (R4)** — *I see value lost to the wrong card.* AC: user adds cards (label, network, last4, rate presets labeled "illustrative") · per-order used vs best card with the math shown · monthly "missed value" total. **P1 · M · Backend+Frontend · Inn, Imp**
- **F3.2 Points balance + expiry** — *I use points before they vanish.* AC: balances/expiry extracted from rewards emails with evidence · "expiring in N days" card · low confidence → review queue. **P2 · M · Ingestion · Imp**
- **F3.3 Screenshot vision import** — *I add a rewards balance from a screenshot.* AC: upload image → vision model returns balance/expiry/program with confidence · user confirms before saving · image not stored after extraction. **P2 · M · Ingestion · Tech, Inn**
- **F3.4 Capped rebuy via mock rail** — see §7. **P1 · M · Backend+Frontend · Imp, Trust, Inn**

### Stretch (only after feature freeze gates are green)
- **F4.1** Wishlist price comparison (discovery/decision) · P2 · M · Backend
- **F4.2** Dispute drafting (item not received / wrong item) · P2 · S · Backend
- **F4.3** Family approvals (second user approves/sends a claim) · P2 · L · Backend+Frontend
- **F4.4** Sentry: tracing per sync + LLM monitoring, masked Replay · P2 · S · Backend · Tech
- **F4.5** Shareable "recovered $X" artifact image · P2 · S · Design
- **F4.6** PDF attachment parsing · P2 · L · Ingestion

## 3. Screen inventory (Paper)
Direction: calm editorial "ledger" — warm off-white, ink numerals, tabular figures, one signal color per state (owed vermilion · deadline amber · saved green), sparing receipt-perforation motif; no purple/gradient AI look. Design owner delivers hero first (h12-20).
| # | Screen | Must show |
|---|---|---|
| 1 | Connect + consent explainer | read-only scope, "will not" list, demo-mode alternative, unverified-app warning heads-up |
| 2 | Sync progress | query used, count, stage names, redaction count, cancel |
| 3 | **Money Ledger (hero)** | "$X waiting for you" count-up, finding cards by kind with countdown chips, confidence badge, "maybe" tray |
| 4 | Ledger timeline | purchases list, filters, status + source-email chips, needs-review badge |
| 5 | Order detail | event timeline, line items, evidence quotes with confidence, Why? panel, edit fields |
| 6 | Claim draft sheet | editable draft, policy quote, amounts, Approve → copy/mailto, "not sent by us" note |
| 7 | Needs-review queue | low-confidence orders, side-by-side quote vs parsed value, confirm/fix |
| 8 | Rewards (L3) | cards, used-vs-best math receipt, expiring points |
| 9 | Rebuy approval (F3.4) | old vs new price, cap meter, "simulated payment" label, approve/block states |
| 10 | Trust + audit + delete | stores/never-does list, audit log, delete-everything with confirmation receipt |
| 11 | Eval view | accuracy table/chart, baseline compare, held-out note |
| 12 | System states | empty inbox, errors, demo banner, loading skeletons, token-expired |
Also: cover image (torn receipt with the headline number), README design-rationale screenshots.

## 4. Key states & edge cases (each needs a designed + tested behavior)
- **Empty inbox / no receipts found:** explain query used, offer demo mode + .eml import; never show "$0 owed" as success without context.
- **Low-confidence parse:** "Needs review", excluded from totals, quote shown; user edit re-runs rules.
- **Duplicate receipts / "updated order":** merge into one order; no double counting in totals.
- **Partial refund / short refund:** show expected vs received, delta, tax/restock-fee explainer; claim drafted for delta only.
- **Multi-currency:** store original currency, label non-USD, no silent conversion in totals (separate subtotal per currency).
- **Forwarded emails:** unwrap forwarded body; attribute to original merchant; lower confidence if headers missing.
- **Refund already received:** auto-resolve finding, show matching email; if claim already drafted, mark moot.
- **Also:** split shipments, multi-item partial returns, store credit vs refund, cancel before ship, non-English receipt (ES), phishing look-alike, final-sale item, merchant with no policy ("policy unknown"), expired OAuth token, Gmail 429.

## 5. AI features (explicit)
| Where | LLM does | Guardrails |
|---|---|---|
| Classify | event type per email (cheap model/rules first) | not_receipt/marketing class; confusion matrix reported |
| Extract | schema-validated fields + policy window/quote from text | per-field confidence + evidence quote; retry once; low conf → review |
| Merchant category (L3) | category for rewards math | cached; rates are user presets |
| Claim drafting | wording only | numbers/dates injected from rules; human approves |
| Vision (F3.3) | read points/expiry from screenshot | user confirms; image discarded |
| Confidence | calibration, routing to review | % at conf ≥0.8 correct, reported |
**Rules are deterministic code** (LLM never computes money). **Showing real AI work (Visa Tech):** `/eval` page with precision/recall vs baselines on a held-out set; per-email evidence + confidence visible in UI; audit log listing each LLM call (redacted-token count, model, cost); redaction pipeline described in README; optional Sentry trace of one sync (extraction latency/cost before vs after cache); architecture diagram with typed stages.

## 6. Trust & responsibility features (Visa Trust 15)
- Read-only `gmail.readonly`; the app cannot send, delete, label or mark-read (scope forbids it).
- Query-narrowed fetch; count + query previewed before first sync.
- Minimal storage: no raw bodies, evidence ≤200 chars, tokens encrypted at rest.
- Redaction (PAN, phone, address → tokens) before any LLM call; provider no-training terms noted in README (verify).
- **Explain-why on every "owed" card:** rule, dates, source quote, confidence, price-source label.
- **Human approval before any message leaves** (copy/mailto only; no outbound mail).
- Audit log UI for every fetch, LLM call, approval, delete. Delete-all revokes token + purges data with receipt.
- "What we will NOT do" panel: send mail, move money without a tap, store full card numbers, read non-receipt mail, share data.
- Honest labels: "Demo data — synthetic", "Simulated price feed", "Illustrative reward rates", "Simulated payment".

## 7. Mock-payment / Visa angle (F3.4, optional, clearly disclosed)
On a price-drop card: **"Rebuy at $X lower, return the original"** against a mock merchant via a simulated Visa-style rail. Rules: visible spend cap (user-set, default $100) · explicit approval sheet showing amounts and cap meter · over-cap attempt is **blocked live with a plain-language reason** (the Trust demo moment) · audit entry per attempt · every screen labeled "Simulated payment — no real money, no real Visa API". Never claim a real rail unless it actually ran. **Stage count (Visa wants ≥3):** post-purchase (L1-2) + loyalty (L3 F3.1) + checkout/payments (F3.4) = 3. If L3 is cut, F3.4 must exist, or only 1-2 stages are covered. Cards shown as user-entered last4/network only.

## 8. MVP, demo, cut lines
**MVP (must be live by h20):** F1.1-F1.8 + F2.1, F2.2, F2.4, F2.5 + F2.3 on mock feed; F2.7 numbers by h24.
**2-minute demo (seeded inbox, ~15 orders visible):** 1. Connect screen: read-only scope, then switch to real Gmail or demo mode (15s) → 2. receipts stream into ledger with parsed fields + source chips; open one with a "Needs review" badge (30s) → 3. hero **"You're owed $187"**, break down into stuck refund / closing window / price drop, tap Why? (35s) → 4. open a draft, approve → copied (20s) → 5. Trust page: audit log then **Delete everything**, ledger empties (20s). *If F3.4 built:* replace part of step 4 with a capped rebuy that gets blocked above the cap (+20s, trim step 2). Backup: recorded real-Gmail clip.
**Cut order (first to last):** F4.x → F3.3 → F3.2 → F1.9 → F2.6 → F3.1 (only if F3.4 stays) → F2.3 live sources beyond mock → F3.4 (**cut only if F3.1 stays**; never cut both) → F2.7 page (keep README numbers). **Never cut:** F1.2, F1.7, F1.8, F2.1, F2.4, F2.5.
**Gates:** h10 real ledger row + one refund_overdue finding end-to-end (else ship demo mode only) · h20 MVP done · h24 feature freeze · h28 re-consent OAuth.

## 9. Non-goals
Real merchant integrations or scraping retailer sites · real payments or real Visa API claims · sending email on the user's behalf · production Gmail verification · push/Pub/Sub sync · bank/statement access · subscriptions cancellation or bill negotiation · mobile app · multi-inbox · legal-grade claims advice.

## 10. Stack options and work breakdown (originally Devin tickets; Devin dropped)
**Option A (recommend): Next.js (App Router) + TS + Tailwind + Framer Motion, route handlers + in-process jobs, SQLite via Drizzle, zod schemas, one LLM with JSON-schema output (cache + fixtures), localhost/Vercel.** One repo/language, shared types UI↔rules, fastest for Devin parallel tickets and Paper token import.
**Option B: React/Vite frontend + FastAPI (Python) + Postgres.** Better Python eval/ML tooling; two services, duplicated types, slower integration. Choose only if the team's strength is Python.
| Ticket | Scope | Features |
|---|---|---|
| D1 | Scaffold, schema, CI, Paper tokens import | all |
| D2 | Seed generator: 8 store templates, 45+ emails, gold labels, expected_findings, inbox.json | F1.2, F2.7 |
| D3 | Gmail OAuth, sync, backoff, token encrypt, revoke | F1.1, F1.9 |
| D4 | Redaction, prefilter, classify, extract, cache | F1.3, F1.4 |
| D5 | Order matcher/dedupe | F1.5 |
| D6 | Rules engine R1-R3 + lifecycle, table/property tests | F2.1-F2.3, F2.6 |
| D7 | Price sources: mock feed, fast-forward, email_promo | F2.3 |
| D8 | Eval harness, /eval page, CI gate | F2.7 |
| D9 | UI from Paper specs: ledger, order, hero, draft sheet, review queue | F1.6, F1.7, F2.4, F2.5 |
| D10 | Trust page, audit log UI, delete-all e2e | F1.8 |
| D11 | Cards + rewards math, points extraction | F3.1, F3.2 |
| D12 | Mock rail + cap/approval/block flow | F3.4 |
| D13 | Vision screenshot import | F3.3 |
| D14 | Playwright e2e of the demo path (QA) | MVP |
Critical path: D1 → D2/D3 → D4 → D5 → D6 → D9. Human reviews and merges.

## 11. Open questions for the team
- [x] **Name:** PaperTrail (decided)
- [ ] **Roles:** owners for Design (Paper) / Ingestion (Gmail+LLM) / Backend (rules+rail) / Frontend / QA — ___
- [ ] **Stack:** Option A or B; which LLM + key; SQLite or hosted Postgres — ___
- [ ] **Layer 3:** include rewards (F3.1)? If not, commit to F3.4 rebuy for the 3-stage bar — yes / no
- [ ] **Rebuy (F3.4):** build it? Does Visa sandbox access exist, or mock only? — ___
- [ ] **Demo inbox:** throwaway Gmail with test users added, plus fixture fallback; who seeds it and by when — ___
- [ ] **Lead headline:** explainable evidence trail vs trust-first — ___
- [ ] **Optional overlay:** Sentry (F4.4) yes/no (≤10% effort) — ___
