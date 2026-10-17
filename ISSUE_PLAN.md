# GitHub Issue Plan — PaperTrail

Derived from: `plan.md`, `scope_features.md`, `deepdive_S14.md`, `brief.md`.  
Design guidance: `frontend-design-skill.md` (linked in relevant issues, not turned into issues).

---

## 1. Labels

### Layer labels (sort in build order)
| Name | Color | Description |
|------|-------|-------------|
| `L1-core` | `1D76DB` | Layer 1: Gmail connect, ledger, trust page |
| `L2-refunds` | `5319E7` | Layer 2: Refund tracker, return deadlines, price drops |
| `L3-rewards` | `FBCA04` | Layer 3: Rewards/points (cut first if behind) |
| `stretch` | `C5DEF5` | Stretch goals (only if ahead of schedule) |

### Work-area labels
| Name | Color | Description |
|------|-------|-------------|
| `ingestion` | `0E8A16` | Gmail fetch, parsing, LLM extraction, redaction |
| `backend` | `006B75` | API routes, rules engine, data layer, OAuth |
| `frontend` | `D93F0B` | UI components, pages, interactions |
| `design` | `E99695` | Paper designs, visual direction, assets |
| `infra` | `BFD4F2` | Repo setup, CI, deploy, env, tooling |
| `qa` | `BFDADC` | Test data, eval harness, fixtures, e2e tests |

### Status labels
| Name | Color | Description |
|------|-------|-------------|
| `blocked` | `B60205` | Waiting on another issue or external dependency |
| `bug` | `d73a4a` | *(exists)* Something isn't working |

**Labels to skip (already exist but not needed for this project):** `documentation`, `enhancement`, `duplicate`, `invalid`, `wontfix`, `question`, `good first issue`, `help wanted`, `accessibility`

---

## 2. Issues

### Legend
- **Est:** estimated hours (1-3h max per issue)
- **Deps:** issues that must complete first (by number or title)
- **Ref:** links to doc sections

---

### Infra & Setup (do first)

#### Issue #1: Scaffold Next.js project with TypeScript, Tailwind, Drizzle
**Labels:** `L1-core`, `infra`  
**Est:** 2h

**Goal:** Initialize the repo with the agreed stack so all other work can begin.

**Directory/files:**
- `/` (package.json, tsconfig, tailwind.config, drizzle.config)
- `/src/app/` (Next.js app router)
- `/src/db/` (schema stub)
- `/src/lib/` (shared utils)

**Acceptance criteria:**
- [ ] `npm run dev` serves a hello-world page at localhost:3000
- [ ] Tailwind classes render; Drizzle schema compiles
- [ ] CI (GitHub Actions) runs lint + type-check on push
- [ ] `.env.example` documents required vars (no secrets committed)

**Dependencies:** None (first issue)

**Ref:** `scope_features.md` §10, `deepdive_S14.md` §8 D1

---

#### Issue #2: Set up GCP project, OAuth client, and throwaway test Gmail
**Labels:** `L1-core`, `infra`  
**Est:** 1h

**Goal:** Create the Google Cloud project and OAuth credentials needed for Gmail access.

**Directory/files:**
- GCP Console (external)
- `.env.example` updated with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

**Acceptance criteria:**
- [ ] GCP project created with Gmail API enabled
- [ ] OAuth consent screen in Testing mode, `gmail.readonly` scope added
- [ ] Web client credentials created with `http://localhost:3000/api/auth/callback` redirect
- [ ] Throwaway Gmail account added as test user
- [ ] Credentials stored securely (not in repo)

**Dependencies:** None

**Ref:** `deepdive_S14.md` §5 (Gmail OAuth), `plan.md` §5 Risk #1

---

### Layer 1 — Core Ledger + Trust

#### Issue #3: Gmail OAuth flow with PKCE and token storage
**Labels:** `L1-core`, `backend`  
**Est:** 3h

**Goal:** Implement secure Gmail OAuth so users can connect their inbox.

**Directory/files:**
- `/src/app/api/auth/` (callback, token routes)
- `/src/lib/auth/` (PKCE, token encryption)
- `/src/db/schema.ts` (user_tokens table)

**Acceptance criteria:**
- [ ] `/connect` redirects to Google with `gmail.readonly` scope, PKCE, and state
- [ ] Callback exchanges code for tokens; refresh token stored encrypted
- [ ] Re-consent flow works when 7-day Testing token expires
- [ ] Non-test-user gets clear error, not a crash

**Dependencies:** #1 (scaffold), #2 (GCP setup)

**Ref:** `scope_features.md` F1.1, `deepdive_S14.md` §5

---

#### Issue #4: Demo mode with fixture inbox loader
**Labels:** `L1-core`, `ingestion`  
**Est:** 2h

**Goal:** Allow judges to use the app without Gmail access via seeded demo data.

**Directory/files:**
- `/seed/inbox.json` (fixture emails)
- `/src/lib/demo/` (loader)
- `/src/app/` (demo mode toggle)

**Acceptance criteria:**
- [ ] One-click "Demo mode" loads `seed/inbox.json` through the same pipeline as Gmail
- [ ] Persistent "Demo data — synthetic" banner visible on all pages
- [ ] Demo path works fully offline with cached LLM output
- [ ] `.eml` / `.mbox` file upload also works

**Dependencies:** #1

**Ref:** `scope_features.md` F1.2

---

#### Issue #5: Generate seed inbox with 45+ emails across 8 stores
**Labels:** `L1-core`, `qa`  
**Est:** 3h

**Goal:** Create realistic test data covering all edge cases for parsing and rules.

**Directory/files:**
- `/seed/templates/` (HTML/plain templates per store)
- `/seed/inbox.json` (generated emails)
- `/seed/expected_findings.json` (ground truth)
- `/scripts/generate-seed.ts`

**Acceptance criteria:**
- [ ] 45+ emails from 8 fictional stores (marketplace, big-box, electronics, apparel, beauty, furniture, grocery, DTC subscription)
- [ ] Edge cases covered: partial return, split shipment, store credit, short refund, multi-currency, forwarded, non-English, phishing lookalike, marketing-not-order
- [ ] `expected_findings.json` has ground truth for 4 refund_overdue, 2 refund_short, 5 return deadlines, 3 price drops
- [ ] README documents that data is synthetic

**Dependencies:** #1

**Ref:** `scope_features.md` §6 (was in deepdive), `deepdive_S14.md` §6

---

#### Issue #6: Email prefilter, redaction, and classification
**Labels:** `L1-core`, `ingestion`  
**Est:** 3h

**Goal:** Filter to receipt-like emails only, redact PII before LLM, classify email type.

**Directory/files:**
- `/src/lib/ingestion/prefilter.ts`
- `/src/lib/ingestion/redact.ts`
- `/src/lib/ingestion/classify.ts`

**Acceptance criteria:**
- [ ] Gmail query filters to receipt-like senders/subjects; query shown to user
- [ ] PANs, phones, street addresses replaced with tokens before any LLM call
- [ ] Classifier outputs: order, shipped, delivered, return_started, return_received, refund, price_adjust, cancel, marketing, not_receipt
- [ ] Marketing/phishing lookalikes never become orders
- [ ] Unit tests with fixtures pass

**Dependencies:** #1, #5 (needs seed data to test)

**Ref:** `scope_features.md` F1.3

---

#### Issue #7: LLM structured extraction with schema validation
**Labels:** `L1-core`, `ingestion`  
**Est:** 3h

**Goal:** Extract structured order data from emails using LLM with confidence scores.

**Directory/files:**
- `/src/lib/ingestion/extract.ts`
- `/src/lib/ingestion/schema.ts` (Zod schemas)
- `/src/lib/ingestion/cache.ts`

**Acceptance criteria:**
- [ ] Output: merchant, order_ref, date, currency, line_items, totals, last4, customer_name (schema-validated)
- [ ] Per-field confidence 0-1 + evidence snippet ≤200 chars
- [ ] Invalid LLM output retried once, then routed to review queue (never silently dropped)
- [ ] Results cached by hash of redacted text
- [ ] Works with seeded fixtures

**Dependencies:** #6 (redaction)

**Ref:** `scope_features.md` F1.4

---

#### Issue #8: Order matching and deduplication
**Labels:** `L1-core`, `backend`  
**Est:** 2h

**Goal:** Group multiple emails into single orders, avoiding double-counting.

**Directory/files:**
- `/src/lib/orders/matcher.ts`
- `/src/db/schema.ts` (orders, events tables)

**Acceptance criteria:**
- [ ] Events grouped by order_ref; fallback to merchant+amount+date proximity
- [ ] Duplicate/updated confirmations merge, never double-count
- [ ] Out-of-order timestamps resolve correctly
- [ ] Unit tests with multi-email order scenarios pass

**Dependencies:** #7 (extraction)

**Ref:** `scope_features.md` F1.5

---

#### Issue #9: Design system and Paper token import
**Labels:** `L1-core`, `design`  
**Est:** 2h

**Goal:** Establish visual foundation in Paper matching the "calm editorial ledger" direction.

**Directory/files:**
- Paper project (external)
- `/src/styles/` (CSS vars, tokens)
- `/public/` (assets if any)

**Acceptance criteria:**
- [ ] Color palette defined: warm paper off-white base, ink-black text, vermilion (owed), amber (deadline), green (saved)
- [ ] Typography: serif/grotesk pairing, tabular figures, clear type scale
- [ ] Receipt-perforation motif documented (dashed rules, torn edges — used sparingly)
- [ ] Tokens exportable to Tailwind config

**Dependencies:** #1

**Ref:** `scope_features.md` §9, `frontend-design-skill.md` (design principles)

---

#### Issue #10: Ledger timeline UI
**Labels:** `L1-core`, `frontend`  
**Est:** 3h

**Goal:** Build the main ledger view showing all orders.

**Directory/files:**
- `/src/app/ledger/page.tsx`
- `/src/components/OrderCard.tsx`
- `/src/components/StatusChip.tsx`

**Acceptance criteria:**
- [ ] Reverse-chron list with merchant, total, status chip, source-email chip
- [ ] Filter by merchant/status works
- [ ] Order detail view shows event timeline (ordered→shipped→returned→refunded) with evidence quotes
- [ ] Loads <1s on 50 orders
- [ ] Follows design system from #9

**Dependencies:** #8 (orders), #9 (design)

**Ref:** `scope_features.md` F1.6, `frontend-design-skill.md`

---

#### Issue #11: Needs-review queue UI
**Labels:** `L1-core`, `frontend`  
**Est:** 2h

**Goal:** Surface low-confidence extractions for human review.

**Directory/files:**
- `/src/app/review/page.tsx`
- `/src/components/ReviewCard.tsx`

**Acceptance criteria:**
- [ ] Orders with min confidence <0.7 show "Needs review" badge
- [ ] These orders excluded from "owed" totals until confirmed
- [ ] Inline edit of fields works; edits logged to audit
- [ ] Confirming removes from queue and includes in totals

**Dependencies:** #7 (extraction with confidence), #10 (ledger)

**Ref:** `scope_features.md` F1.7

---

#### Issue #12: Trust page with audit log and delete-all
**Labels:** `L1-core`, `frontend`, `backend`  
**Est:** 3h

**Goal:** Build the transparency page that shows exactly what the app does and lets users delete everything.

**Directory/files:**
- `/src/app/trust/page.tsx`
- `/src/lib/audit/` (logging)
- `/src/app/api/delete-all/`

**Acceptance criteria:**
- [ ] Lists what is read/stored and "will not" list (send mail, move money, etc.)
- [ ] Audit log shows every Gmail fetch, LLM call (redacted token count), approval, delete
- [ ] "Delete everything" revokes OAuth token, purges all user data, shows confirmation
- [ ] Ledger visibly empties after delete
- [ ] Per-merchant exclude option works

**Dependencies:** #3 (OAuth for revoke), #8 (data to delete)

**Ref:** `scope_features.md` F1.8

---

### Layer 2 — Refunds, Returns, Price Drops

#### Issue #13: Refund tracker rules engine (R1)
**Labels:** `L2-refunds`, `backend`  
**Est:** 3h

**Goal:** Detect overdue or short refunds based on email events.

**Directory/files:**
- `/src/lib/rules/refund.ts`
- `/src/lib/rules/engine.ts`
- `/src/db/schema.ts` (findings table)

**Acceptance criteria:**
- [ ] Rule R1: return_received + no refund email after SLA → `refund_overdue` finding
- [ ] Rule: refund amount < expected (beyond tolerance) → `refund_short` with delta
- [ ] Findings link to source emails with evidence quote
- [ ] Injectable clock for testing; property tests against `expected_findings.json`

**Dependencies:** #8 (orders with events)

**Ref:** `scope_features.md` F2.1, `deepdive_S14.md` §4 R1

---

#### Issue #14: Return deadline tracker rules (R2)
**Labels:** `L2-refunds`, `backend`  
**Est:** 2h

**Goal:** Detect return windows that are closing soon.

**Directory/files:**
- `/src/lib/rules/return.ts`
- `/src/lib/rules/policies.ts` (default return windows)

**Acceptance criteria:**
- [ ] Rule R2: order date + return_window_days - now ≤ threshold → `return_closing` finding
- [ ] Policy lookup by merchant or default (30 days)
- [ ] Finding shows days remaining and deadline date
- [ ] Tests pass against expected_findings

**Dependencies:** #8, #13 (rules engine base)

**Ref:** `scope_features.md` F2.2

---

#### Issue #15: Price drop detection with mock feed (R3)
**Labels:** `L2-refunds`, `backend`  
**Est:** 2h

**Goal:** Detect price drops within price-adjustment window.

**Directory/files:**
- `/src/lib/rules/pricedrop.ts`
- `/src/lib/prices/mock-feed.ts`
- `/seed/price-feed.json`

**Acceptance criteria:**
- [ ] Rule R3: current_price < paid (beyond threshold) within adjustment window → `price_drop` finding
- [ ] Mock price feed clearly labeled "simulated" in UI
- [ ] Promo emails in inbox also count as price signal
- [ ] Finding shows original price, current price, delta, evidence

**Dependencies:** #8, #5 (seed data with price scenarios)

**Ref:** `scope_features.md` F2.3, `deepdive_S14.md` §4 R3

---

#### Issue #16: Hero "You're owed $X" card UI
**Labels:** `L2-refunds`, `frontend`  
**Est:** 3h

**Goal:** Build the headline UI element showing total money owed.

**Directory/files:**
- `/src/app/page.tsx` (or dashboard)
- `/src/components/HeroCard.tsx`
- `/src/components/FindingCard.tsx`

**Acceptance criteria:**
- [ ] Big-number headline: "$X waiting for you"
- [ ] Stacked finding cards below (refund overdue, deadline closing, price drop)
- [ ] Each card shows amount, countdown/days, "Why?" expandable with evidence
- [ ] Follows "calm editorial ledger" design; not a gradient/purple AI look
- [ ] Empty state when nothing owed

**Dependencies:** #13, #14, #15 (findings), #9 (design)

**Ref:** `scope_features.md` F2.4, §9, `frontend-design-skill.md`

---

#### Issue #17: Claim draft sheet with human approval
**Labels:** `L2-refunds`, `frontend`, `backend`  
**Est:** 3h

**Goal:** Generate drafted claims that users can approve and send themselves.

**Directory/files:**
- `/src/app/claim/[id]/page.tsx`
- `/src/components/ClaimDraft.tsx`
- `/src/lib/claims/draft.ts`

**Acceptance criteria:**
- [ ] Draft cites order ref, amounts, policy quote; numbers from rules, LLM writes wording only
- [ ] Draft signed with customer_name from receipt (falls back to Google profile name)
- [ ] User can edit before approving
- [ ] "Approve" → copy to clipboard or `mailto:` link; app never sends automatically
- [ ] Approval logged to audit

**Dependencies:** #13, #16 (findings to draft from)

**Ref:** `scope_features.md` F2.5

---

### Layer 3 — Rewards (stub issues only; cut first)

#### Issue #18: [L3] Rewards balance tracker (stub)
**Labels:** `L3-rewards`, `backend`  
**Est:** 2h (if built)

**Goal:** Track points/rewards balances and expiry dates from emails.

**Acceptance criteria:**
- [ ] Parse reward/point balance emails
- [ ] Show combined view of balances + expiry
- [ ] "Use before expiry" card

**Dependencies:** #7 (extraction)

**Ref:** `scope_features.md` F3.1-F3.3

**Note:** This is a stub. Cut if behind schedule per `plan.md` §3.

---

### Stretch (stub issues only)

#### Issue #19: [Stretch] Wishlist price comparison
**Labels:** `stretch`, `backend`  
**Est:** 2h (if built)

**Goal:** Compare prices across stores for wishlist items.

**Note:** Stub only. Build only if ahead. See `scope_features.md` F4.1.

---

#### Issue #20: [Stretch] Dispute drafting
**Labels:** `stretch`, `backend`  
**Est:** 2h (if built)

**Goal:** Draft dispute messages for item-not-received or wrong-item scenarios.

**Note:** Stub only. Build only if ahead. See `scope_features.md` F4.2.

---

### QA & Polish

#### Issue #21: Eval harness and /eval page
**Labels:** `L1-core`, `qa`  
**Est:** 3h

**Goal:** Measure and display parsing/finding accuracy.

**Directory/files:**
- `/src/lib/eval/` (metrics)
- `/src/app/eval/page.tsx`
- `/scripts/run-eval.ts`

**Acceptance criteria:**
- [ ] Metrics: classification F1, per-field exact-match, finding precision/recall vs expected_findings
- [ ] `/eval` page shows results table and charts
- [ ] CI gate fails if finding recall <90% or precision <95%
- [ ] Holdout set (15 emails) never used in prompt tuning

**Dependencies:** #5 (seed + expected), #7 (extraction), #13-15 (rules)

**Ref:** `scope_features.md` §6, `deepdive_S14.md` §6

---

#### Issue #22: End-to-end Playwright tests for demo path
**Labels:** `L1-core`, `qa`  
**Est:** 2h

**Goal:** Automated test of the critical demo flow.

**Directory/files:**
- `/e2e/demo.spec.ts`
- `/playwright.config.ts`

**Acceptance criteria:**
- [ ] Test: load demo mode → ledger populates → hero shows owed amount → approve a draft → trust page delete works
- [ ] Runs in CI
- [ ] Screenshots captured for debugging

**Dependencies:** #4 (demo mode), #10, #16, #17, #12

**Ref:** `plan.md` §4 demo script

---

#### Issue #23: README with architecture diagram and sponsor sections
**Labels:** `L1-core`, `infra`  
**Est:** 2h

**Goal:** Complete documentation for judges and submission.

**Directory/files:**
- `/README.md`
- `/docs/architecture.png` (or mermaid)

**Acceptance criteria:**
- [ ] Problem statement, one-liner
- [ ] Architecture diagram (Gmail → prefilter → LLM → rules → UI)
- [ ] Setup and run instructions
- [ ] Per-sponsor sections: Visa criteria mapping, Devin session links, Paper design rationale
- [ ] Synthetic data disclosure, Testing-mode disclosure
- [ ] Team members, license

**Dependencies:** Most features complete

**Ref:** `plan.md` §4 submission checklist

---

## 3. Issue Template

File: `.github/ISSUE_TEMPLATE/task.md`

```markdown
---
name: Task
about: A scoped unit of work for the hackathon
title: ''
labels: ''
assignees: ''
---

## Goal
<!-- One sentence: what does this accomplish? -->

## Directory/files
<!-- Where will changes land? -->
- `/src/...`

## Acceptance criteria
<!-- Testable "done when" bullets -->
- [ ] ...
- [ ] ...

## Dependencies
<!-- Issue numbers or titles this waits on; "None" if first -->

## Estimate
<!-- 1-3 hours -->

## References
<!-- Links to doc sections, e.g. `scope_features.md` F1.2 -->
```

---

## 4. Open Questions & Assumptions

### Open questions (need your input)
1. **Sentry issues:** Should I create issues for Sentry integration (Tracing, AI monitoring)? It's marked optional/skip-if->10%-effort in plan.md.
2. **Devin logging:** Should there be an issue specifically for maintaining the Devin session log, or is that just a process we follow?
3. **Video recording:** Should there be an issue for recording the backup demo video, or is that outside GitHub tracking?
4. **Layer 3 vs capped rebuy:** Plan.md says this is undecided. Should I create issues for both paths or just the L3 stub?

### Assumptions I made
1. **Issue count:** 23 issues (within 15-25 target). Layer 3 and stretch are stubs only.
2. **frontend-design-skill.md:** Linked in design/frontend issues (#9, #10, #16) but not turned into issues per your instructions.
3. **Existing labels:** I'll reuse `bug` (exists). I'll create all others fresh.
4. **Demo mode priority:** Treated as P0 since judges can't log into real Gmail.
5. **Order of work:** Issues numbered so L1 builds end-to-end first (#1-12), then L2 (#13-17), then L3/stretch stubs, then QA/polish.
6. **Naming:** Used "PaperTrail" throughout (most recent decision in scope_features.md).

---

## ⏸️ STOPPING HERE — Awaiting Your Approval

Please review:
1. **Labels** — any to add/remove/rename?
2. **Issues** — scope, titles, groupings okay? Any missing?
3. **Issue template** — format acceptable?
4. **Open questions** — your answers?

Reply with approval or edits. I will not run any `gh` commands until you confirm.
