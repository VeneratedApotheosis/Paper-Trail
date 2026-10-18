# LA Hacks 2026 — S14 Plan (living tracker)

**Project: S14 — Receipt Ledger + Refunds + Rewards Manager** (working title; deepdive working name "Tally"). Single source of truth, one writer. Last updated: 2026-10-16 · Clock: ~36h hack, T0 = kickoff (unconfirmed).

Read-only Gmail → every purchase becomes a ledger row → the agent finds money you're owed (stuck refunds, closing return windows, price drops) as one **"You're owed $X"** number, each with an evidence trail (source-email quote + confidence) and a drafted claim the user approves (never auto-sent). Optional layer: rewards/points balances + expiry. Custom web app (own frontend + backend), software-only. Main track default: **Applied Intelligence**.

Docs: [scope_features.md](scope_features.md) (features, priorities) · [deepdive_S14.md](deepdive_S14.md) (architecture, rules R1-R4, Gmail OAuth, eval, work breakdown T1-T10, Paper screens) · [brief.md](brief.md) (condensed sponsor/track brief)

---

## 1. Locked decisions (do not re-open)

1. **Software-only, custom web app.** No hardware (QNX, Espressif, Even Realities out).
2. **Targets:** Paper *Best Designed Hack* (custom polished frontend; use Paper, code `LAHACKS26`) · Visa *Future of Shopping*. Optional overlay: Sentry (≤10% effort). (Cognition *Best Use of Devin* was dropped on 2026-10-17; Devin is back as a coding agent under Kenan's supervision since 2026-10-18; see decision log.)
3. **Excluded:** Cognition/Devin as a sponsor target (dropped 2026-10-17; Devin itself is back as a supervised coding agent since 2026-10-18, see decision log).  Fetch ASI:One/Agentverse — workflow must live inside asi1.ai chat (no custom frontend), which blocks the Paper-designed frontend. Base44 — must be built substantially on Base44, replacing our custom stack. Hardware sponsors — software-only.
4. **Scope layers** (from user spec): **L1** Gmail `gmail.readonly` connect → receipt ledger/timeline → Trust page (what we read/store, delete-everything). **L2** pending refunds, return deadlines, price drops → "You're owed $X" → one-tap drafted claim. **L3 (cut first)** rewards/points + expiry. **Stretch:** wishlist price comparison, dispute drafting, family approvals. **Out of scope:** real merchant integrations, real payments (mock unless a Visa sandbox is actually available), scraping.
5. Never claim a real Visa rail/API unless it actually ran; any payment/refund movement is mocked and disclosed.

## 2. Open decisions

- [ ] **Team size & skills** — headcount (max 4 typical). Names: ___
- [x] **Name** — PaperTrail (decided). Avoid confusion with the Paper sponsor; keep branding our own.
- [ ] **Roles** — owner of Gmail OAuth/parsing · refund/price rules engine · ledger UI (Paper); one person merges to main. ___
- [ ] **Stack** — confirm web stack + LLM for structured receipt extraction + datastore (deepdive proposes Next.js/TS/Tailwind + SQLite/Drizzle; LLM key needed). ___
- [ ] **Layer 3 vs capped rebuy** — without L3 *or* a capped "rebuy at lower price" checkout via a disclosed mock Visa rail, S14 covers only 1 Visa stage (post-purchase); target is ≥3 stages. L3 → loyalty stage (2 stages); rebuy → checkout/payments (3 with both). ___
- [ ] **Demo inbox** — throwaway Gmail (≥45 emails, 8 fictional stores, labeled synthetic) vs `.eml`/mbox fixture-only; demo-mode (`seed/inbox.json`) is the guaranteed path regardless. ___
- [ ] **Visa sandbox** — is any sandbox/developer access actually available? Verify early; otherwise mock and disclose. ___
- [ ] **Accounts/keys** — Paper Pro (`LAHACKS26`), Devpost, GCP project + throwaway Google account + test users (≤100), LLM key(s), optional Sentry.
- [ ] **Optional Sentry overlay** — in or out (default skip if >10% effort).
- [ ] **Scope freeze signed by all** (target h3). Date/time: ___

## 3. 36h timeline & gates (T0 = kickoff; adjust)

| Hours | Goal | Gate | Done |
|---|---|---|---|
| 0-3 | Team sync, hard-req matrix, decisions above, spec + roles; GCP/OAuth project, throwaway inbox, test users; T1-T2 started | **Scope freeze** signed | [ ] |
| 3-4 | Repo, env, keys, (Sentry init), skeleton deploy, task board | Hello-world deployed e2e | [ ] |
| 4-10 | Thinnest slice: Gmail/demo ingest → ledger row → refund_overdue finding | **h10: real Gmail → ≥1 ledger row + 1 refund_overdue finding** (if red, ship demo-mode only; OAuth as side thread) | [ ] |
| 10-12 | Sponsor-gate check: each hard requirement tested once | Compliance list green/red | [ ] |
| 12-20 | L1 complete, L2 started; Paper hero done (h12-20); agents on scoped tickets | **h20 must-done = L1 + R3 (mock price feed)** | [ ] |
| 20-24 | Integration, error handling, eval numbers | **Feature freeze h24** (cut L3 first, then R4 before R3; never cut R1/trust) | [ ] |
| 24-28 | Sleep shifts (alternate 2); non-author testing; bug bash; **re-consent Gmail OAuth** (7-day token) | Zero P0 bugs | [ ] |
| 28-31 | Polish, design pass, README, architecture diagram, screenshots | Repo public + clean | [ ] |
| 31-33 | Record backup demo video (+ 60-s real-Gmail clip); rehearse live ×3 | Video + script done | [ ] |
| 33-35 | Devpost draft, per-sponsor forms (Paper, Visa) | All forms filled | [ ] |
| 35-36 | Submit (aim 1-2h early); verify links in incognito | Confirmation saved | [ ] |

Scope rule: behind by >2h at any gate → cut a "should" immediately. No new features after h24. Stop coding at h31.

## 4. Sponsor requirements & submission checklist

| Sponsor | Requirement | S14 angle |
|---|---|---|
| **Visa Future of Shopping** ($2000 1st) | GenAI shopping app across stages (discovery, decision, personalization, checkout, payments, loyalty, post-purchase; cover ≥3). Judged Innovation 25 · UX 25 · Technical 20 · Commerce impact 15 · Trust & Responsibility 15 | Post-purchase core + loyalty (L3) + payments (card last4); approval step, audit trail, "what the agent will NOT do". Deepdive self-score ≈71 → 83/100 with raises |
| **Paper Best Designed Hack** ($1500/1000/500) | Design fundamentals, ease of use, personal craft, not obviously AI-generated; use Paper + `LAHACKS26` | Calm editorial "ledger" look; hero = big-number "owed" card + receipt-styled timeline; consent/trust as designed moments |
| Sentry (optional) | Sentry + ≥2 products beyond errors (Tracing, Logs, Replay, AI monitoring) | Trace per sync + LLM monitoring; Replay fully masked |

**Demo (~2 min seeded inbox, from scope draft):** connect Gmail → consent shows read-only scope (15s) → receipts stream into ledger with parsed fields + source-email chips (30s) → hero "You're owed $187" (1 refund stuck 12 days, 1 return window closing in 3 days, 1 price drop $42, evidence each) (35s) → approve one drafted claim (20s) → Trust page "Delete everything" live, ledger empties (20s). Driver + narrator assigned; recorded fallback ready.

- [ ] **GitHub:** public; README (problem, architecture diagram, setup, run, per-sponsor section, team, synthetic-data and Testing-mode disclosures, eval table); no secrets (`.env` ignored, scanned); license; commit history; screenshots/GIF
- [ ] **Devpost:** title, tagline, description (inspiration/what/how/challenges/accomplishments/learned/next); main track + every sponsor challenge opted in; video (≤3 min, public/unlisted); repo + live demo links; Paper-designed cover; team added; built-with tags
- [ ] **Paper:** designed in Paper (`LAHACKS26`); screenshots/design files; cover designed in Paper; design-rationale section in README
- [ ] **Visa:** Devpost maps each criterion and the stages covered; shows approval step/audit trail; mock rail disclosed
- [ ] **Sentry (optional):** screenshots (Replay/Logs/Tracing) + before/after note on how it changed the build
- [ ] **Final:** submitted early; every link opened logged-out; Devpost status "Submitted"; one person on-call until judging

## 5. Risks (S14)

| # | Risk | Mitigation | Status |
|---|---|---|---|
| 1 | Gmail `gmail.readonly` is a restricted scope; Testing mode = ≤100 test users, unverified-app warning, tokens expire 7 days after consent; judges can't log in | Stay in Testing; demo mode + `.eml`/mbox fallback + 60-s recorded real-Gmail clip; re-consent on demo morning; disclose in README/demo | [ ] |
| 2 | Prior art (Rocket Money, Earny, Paribus) — ledger alone isn't novel | Lead with one hook: explainable "why you're owed" with per-dollar email evidence; trust-first design | [ ] |
| 3 | Visa fit: only 1-2 stages, no money movement | Decide L3 / capped mock-rail rebuy; Trust & Responsibility as headline; never claim a real Visa rail | [ ] |
| 4 | Rules/price data hand-waved (no free reliable price source) | Rules R1-R4 in deepdive; mock price feed (labeled "simulated") + in-inbox promo emails; "owed" shows confidence, never overstated | [ ] |
| 5 | Parsing accuracy on messy receipts | Labeled set (≥30 emails, ≥8 styles, edge cases, ~15 held out), field-level + finding precision/recall in README; low-confidence → review queue | [ ] |
| 6 | Privacy optics ("why read my mail?") | Read-only, redaction pre-LLM, audit log, delete-all live in demo; masked Sentry Replay | [ ] |
| 7 | "Looks like a spreadsheet" | Paper hero design + big-number storytelling | [ ] |
| 8 | Core path unproven by h10 | Demo-mode only; cut to R1 + trust | [ ] |
| 9 | Missed sponsor requirement (Paper visibility, Visa mapping) | Sponsor-gate check h10-12; owner per requirement | [ ] |
| 10 | Live demo failure / secrets in repo / burnout / single-person dependency | Recorded video, cached LLM output, seeded data, 2nd laptop; scan before public; sleep shifts; second person can run demo | [ ] |

## 6. Ideas / Decision Log (append-only)

Format: `- YYYY-MM-DD — <author> — <change/decision> — <why> — <impact>`. Never edit past entries; add a new one to supersede.

<!-- append new entries below this line -->
- 2026-10-16 — user (applied by plan worker) — LOCKED: software-only; targets Devin + Paper (`LAHACKS26`) + Visa; EXCLUDED Fetch/Agentverse (no custom frontend possible) and Base44 (would replace the stack); other sponsors optional overlays only — Why: custom polished frontend + shopping app + heavy Devin use is a consistent stack — Impact: scope limited to software, custom web app.
- 2026-10-16 — user (applied by plan worker) — IDEA S14 "Receipt Ledger + Refunds + Rewards Manager": Gmail read-only → ledger + trust page (L1); refunds/return deadlines/price drops + "You're owed $X" + drafted claim (L2); rewards/points + expiry (L3, cut first); stretch wishlist price compare, dispute drafting, family approvals; out of scope real merchant integrations, real payments (mock unless Visa sandbox), scraping — Why: concrete money-recovery problem, deterministic seeded demo, strong Trust/Paper surface — Impact: planner estimate ~350/500 at the time (Visa lens ~71, ~76 with capped mock-rail rebuy); open questions: name, roles, stack, L3.
- (date unrecorded) — user — SETTLED on S14 as the project; other ideas dropped — Why: user decision — Impact: plan.md trimmed to S14 only; open decisions in §2 (name, roles, stack, L3 vs rebuy, demo inbox, Visa sandbox).
- 2026-10-17 — user (Kenan; applied by kenan-pi-1) — DROPPED Cognition *Best Use of Devin* entirely; targets are now Paper + Visa (+ optional Sentry) — Why: Devin was never used; the team builds with its own agents (pi, Codex, etc.) coordinated via GitHub Issues — Impact: removed Devin rules (branches/PRs, session log) from COORDINATION.md/AGENTS.md, Devin rows from this plan, and the Devin section from the README (#23); deepdive/scope "Devin tickets" sections are now just a work breakdown.
- 2026-10-18 — user (Kenan; applied by kenan-devin-1) — Devin BACK as a coding agent under Kenan's supervised use — Why: Kenan wants to use Devin again, directed by him — Impact: agent IDs `kenan-devin-<n>`; same rules as every other agent (claim, file ownership, push to `main`, `Agent:` trailer, DONE handoff); no Devin-specific workflows, PR flow, or session logs; sponsor targets unchanged (Paper + Visa, optional Sentry).
