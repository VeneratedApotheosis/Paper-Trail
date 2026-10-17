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

## Team
| Person | GitHub | Owns |
|---|---|---|
| Kenan | `VeneratedApotheosis` | Repo owner, scope decisions, merges Devin PRs |
| Alex | `ptatoo` | All frontend/design + #1 scaffold |
| Ethan Lowe | `ethanwlowe7-cmyk` | Backend/ingestion, claimed per issue |
| Chelsea | `chelsearwang` | Backend/ingestion, claimed per issue |

## Ownership: don't touch Alex's work
**Alex (`ptatoo`) and his agents own all frontend/design work.** Unless you are Alex or one of his agents:
- Do not edit `src/app/**/page.tsx`, `src/app/**/layout.tsx`, `src/components/**`, `src/styles/**`,
  `tailwind.config.*`, `public/**`, or Paper files. That applies even to fixing a build error there.
- Do not claim, relabel, reassign, or close issues **#1, #9, #10, #11, #16, #24, #25, #26**, or the UI parts of
  **#12** and **#17**.
- If you change a schema, type, or API the UI uses, post an `INTERFACE` comment on Alex's issue and tag `@ptatoo`.
- Need a UI change? Open a new `frontend` issue for Alex.
Full rules: COORDINATION.md section 0.

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
GitHub Issues is the **only** live status board. Never coordinate through repo files.

0. **Know who you are.** Pick an agent ID `<person>-<tool>-<n>` (e.g. `chelsea-claude-1`). Put it in every
   comment and as a commit trailer (`Agent: chelsea-claude-1`). COORDINATION.md section 1.
1. **Session start: read the board** (COORDINATION.md section 3). Find your own open claims first
   (`gh issue list --assignee @me`, search your agent ID). Then see who holds what, what's available, blocked or
   closed, and the latest comments on the pinned **Coordination channel, issue #28** (`gh issue view 28 --comments`).
2. **Claim on GitHub before doing any work.** The issue must be unassigned, unblocked, and not Alex's. Assign yourself
   **and** post `CLAIMED by <person> / <agent-id>` with plan, files and ETA. Re-check: the earliest claim wins.
   **No claim = no work.** One active issue per agent.
3. **Keep it updated:** `PROGRESS` every ~2h, `DECISION`, `INTERFACE` (tag dependents), `BLOCKED` + label,
   `UNCLAIMED` + unassign if you stop. COORDINATION.md section 5.
4. Work in **your own checkout/worktree**; `git pull --rebase` first. Stay inside the files your issue names.
5. Small commits `#<N> <summary>`, push often to `main`, never push a broken build.
6. **Finish:** post a `DONE by <person> / <agent-id>` handoff. Close the issue only when every acceptance criterion
   is met. Unblock dependents and announce on the Coordination issue. COORDINATION.md section 6.
7. Blocked or unclear spec: comment on the issue, add `blocked`, and stop — don't invent scope.
