# AGENTS.md — PaperTrail

Instructions for every AI coding agent (Devin, Claude Code, Cursor, pi, etc.) and humans working in this repo.
**Read this file and [COORDINATION.md](COORDINATION.md) before starting any task.**

## What we're building
PaperTrail (LA Hacks 2026): read-only Gmail → every purchase becomes a ledger row → rules find money the user is owed
(overdue/short refunds, closing return windows, price drops) → one **"You're owed $X"** number, each finding backed by an
evidence quote + confidence, with a drafted claim the user approves and sends themselves. Sponsor targets: Devin, Paper, Visa.

## Source of truth (read the relevant section, don't guess)
| Doc | Use it for |
|---|---|
| `plan.md` | Locked decisions, timeline/gates, risks, cut order |
| `scope_features.md` | Feature spec F1.1–F4.x, priorities, edge cases, non-goals |
| `deepdive_S14.md` | Architecture §2, **data model §3**, **rules R1–R4 §4**, Gmail OAuth §5, eval §6 |
| `frontend-design-skill.md` | Visual/design guidance for any UI work |
| `ISSUE_PLAN.md` | How the GitHub issues were derived |
| GitHub Issues | **The task board.** Every unit of work is an issue. |

If a doc and an issue disagree, the issue's acceptance criteria win for that task; note the conflict in an issue comment.

## Stack (locked)
Next.js (App Router) + TypeScript + Tailwind (+ Framer Motion) · Drizzle ORM on SQLite (dev/demo) · Zod for all LLM I/O ·
Next route handlers for the API · Playwright for e2e. Do not add a new framework, ORM, or state library without team agreement.

## Commands
The project is scaffolded by issue #1. Until it lands there is no app code. Afterwards, check `package.json` scripts; expected:
```
npm install
npm run dev         # localhost:3000
npm run lint
npm run typecheck
npm test            # unit tests
npx playwright test # e2e (issue #22)
```
**Before every push:** `lint`, `typecheck`, and `test` must pass locally.

## Planned layout
```
src/app/            # pages + api route handlers
src/components/     # UI components
src/db/schema/      # one Drizzle schema file per domain (orders.ts, findings.ts, audit.ts, ...)
src/lib/ingestion/  # prefilter, redact, classify, extract, cache
src/lib/orders/     # matcher / normalizer
src/lib/rules/      # R1–R4, pure functions, injectable clock
src/lib/audit/      # audit logging
seed/               # synthetic inbox, templates, expected_findings.json
scripts/            # seed generator, eval runner
e2e/                # Playwright specs
```

## Hard product rules (never violate)
1. **Gmail scope is `gmail.readonly` only.** Never request send/modify scopes.
2. **The app never sends email or moves money.** Claims are copy-to-clipboard or `mailto:` after explicit user approval.
3. **Redact before any LLM call** (card numbers, phones, street addresses → tokens). No raw email bodies are stored.
4. **Numbers come from deterministic rules, never from the LLM.** The LLM extracts fields and writes wording only.
5. Every LLM output is **Zod-validated**; invalid → retry once → needs-review queue. Never silently drop.
6. Every Gmail fetch, LLM call, approval, and delete writes an **audit** row.
7. Low confidence (<0.7) items are excluded from "owed" totals until a human confirms.
8. All demo/seed data is **synthetic** and labeled as such in the UI. Mock price feed is labeled "simulated".

## Code conventions
- TypeScript strict; no `any` without a comment explaining why.
- Rules in `src/lib/rules/` are pure functions taking `now` as a parameter — no `Date.now()` inside rules.
- Shared types and Zod schemas live in one place and are imported, not copied.
- Small files, small functions, descriptive names. Match existing style before inventing new patterns.
- Add or update tests for any logic you change (rules, matcher, redaction, extraction parsing).
- UI follows the "calm editorial ledger" direction (scope_features §9): warm off-white, ink-black, tabular figures;
  vermilion = owed, amber = deadline, green = saved. No purple gradients / generic AI look.

## Security
- **Never read, print, log, or commit** `.env*` (except `.env.example`), OAuth tokens, API keys, or `.pi/mcp.json` / `.mcp.json`.
- New env vars go in `.env.example` with a placeholder value and a comment.
- Never paste real personal emails into fixtures, prompts, issues, or commits.

## How to work (summary — full process in COORDINATION.md)
1. Pick an **unblocked** issue, claim it (label + comment).
2. Work in **your own checkout/worktree**; `git pull --rebase` first.
3. Stay inside the files your issue names; if you must touch a shared file, say so in the issue first.
4. Small commits referencing the issue (`#6 add PAN redaction`), push often, never push a broken build.
5. Post a handoff comment when done; close the issue only when every acceptance criterion is checked.
6. If blocked or the spec is unclear: comment on the issue, add `blocked`, and stop — don't invent scope.
