# AGENTS.md — PaperTrail

Instructions for every AI coding agent (pi, Claude Code, Codex, Cursor, etc.) and humans working in this repo.
**Read this file and [COORDINATION.md](COORDINATION.md) before starting any task.**

## What we're building
PaperTrail (LA Hacks 2026): read-only Gmail → every purchase becomes a ledger row → rules find money the user is owed
(overdue/short refunds, closing return windows, price drops) → one **"You're owed $X"** number, each finding backed by an
evidence quote + confidence, with a drafted claim the user approves and sends themselves. Sponsor targets: Paper, Visa (optional Sentry). **Devin/Cognition was dropped (2026-10-17): don't add Devin workflows, PRs, or session logs.**

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
```
npm ci              # ~1-3 min; Node 22 LTS recommended (Node 25 works but may compile better-sqlite3)
npm run dev         # localhost:3000
npm run lint        # `next lint` prints a deprecation notice; it still works
npm run typecheck
npm test            # vitest (src/** and scripts/** tests)
npx playwright test # e2e (issue #22)
```
**Before every push:** `lint`, `typecheck`, and `test` must pass locally.
- `tsx` is not installed; scripts run through vitest. Regenerate seed data: `$env:WRITE_SEED='1'; npx vitest run scripts`.
- Run long commands with a timeout (or in the background with a log file). `npm ci` can stall silently on a network hiccup.

## Layout
```
src/app/            # pages (Alex; being redesigned in Paper) + src/app/api/** JSON route handlers (backend)
src/components/     # UI components (Alex)
src/db/schema/      # one Drizzle schema file per domain (users, orders, findings, audit)
src/lib/contracts/  # canonical Zod schemas/types: RawEmail, Extraction, NormalizedOrder, Finding, seed formats
src/lib/ingestion/  # prefilter, redact, classify, extract (+ prompt), cache
src/lib/llm/        # Anthropic client (fetch, no SDK) + offline fixture client
src/lib/orders/     # matcher / normalizer -> NormalizedOrder
src/lib/pipeline/   # gold-label adapter, end-to-end seed test, runPipeline (#4)
src/lib/prices/     # mock price feed (simulated) + email-promo observations
src/lib/claims/     # claim draft generation (#32)
src/lib/eval/       # eval metrics + CI gate (#21)
src/lib/store/, src/lib/api/, src/lib/demo/   # in-memory store, typed API client, demo loader (#4/#31)
src/lib/auth/       # Gmail OAuth (Chelsea, #3)
src/lib/types.ts, view.ts, format.ts, mock/   # UI view helpers + mocks (Alex)
src/lib/rules/      # R1–R4, pure functions, injectable clock
seed/               # synthetic inbox, gold labels, expected findings, price feed, templates
scripts/            # seed generator + eval writer (run via vitest)
docs/               # design-system.md (Alex), api.md (#4)
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
| Kenan | `VeneratedApotheosis` | Repo owner, scope decisions; backend via orchestrated `kenan-pi-*` agents |
| Alex | `ptatoo` | All frontend/design + #1 scaffold. Redesigning the UI in Paper (current pages will be replaced) |
| ~~Ethan Lowe~~ | `ethanwlowe7-cmyk` | **No longer on the project.** All his claims are stale; don't wait on them |
| Chelsea | `chelsearwang` | Gmail OAuth (#3): `src/app/api/auth/**`, `src/lib/auth/**`, DB init; other backend per issue |

## Ownership: don't touch Alex's work
**Alex (`ptatoo`) and his agents own all frontend/design work.** Unless you are Alex or one of his agents:
- Do not edit `src/app/**/page.tsx`, `src/app/**/layout.tsx`, `src/components/**`, `src/styles/**`,
  `tailwind.config.*`, `public/**`, or Paper files. That applies even to fixing a build error there.
- Do not claim, relabel, reassign, or close issues **#1, #9, #10, #11, #16, #24, #25, #26**, or the UI parts of
  **#12**, **#17**, and the `/eval` page of #21. Backend halves have their own issues (**#31**, **#32**).
- Backend code never depends on page files; the UI reads data through `@/lib/api/client` + `@/lib/contracts`.
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
- **Never post account passwords or credentials** in issues, comments, commits, or agent prompts. The app uses
  Gmail OAuth only; no agent ever needs the test account's password. If one is exposed, tell Kenan so it gets rotated.
- Don't touch another owner's area (e.g. `src/lib/auth/**` is Chelsea's); see COORDINATION.md section 10.

## How to work (summary — full process in COORDINATION.md)
GitHub Issues is the **only** live status board. Never coordinate through repo files.

0. **Know who you are.** Pick an agent ID `<person>-<tool>-<n>` (e.g. `chelsea-claude-1`). Put it in every
   comment and as a commit trailer (`Agent: chelsea-claude-1`). COORDINATION.md section 1.
1. **Session start: read the board** (COORDINATION.md section 3). Find your own open claims first
   (`gh issue list --assignee @me`, search your agent ID). Then see who holds what, what's available, blocked or
   closed, and the latest comments on the pinned **Coordination channel, issue #28** (`gh issue view 28 --comments`).
2. **Claim on GitHub before doing any work.** The issue must be unassigned, unblocked, and not Alex's. Assign yourself
   **and** post `CLAIMED by <person> / <agent-id>` with plan, files and ETA. Read **every** comment first: a
   comment-only claim (no assignee) still counts. Re-check after claiming: the earliest claim wins.
   **No claim = no work.** One active issue per agent. Claims by departed members (Team table) are stale.
   If the other half of an issue belongs to someone else, open a separate `Backend: ... (#N backend half)` issue.
3. **Keep it updated:** `PROGRESS` every ~2h, `DECISION`, `INTERFACE` (tag dependents), `BLOCKED` + label,
   `UNCLAIMED` + unassign if you stop. COORDINATION.md section 5.
4. Work in **your own checkout/worktree**; `git pull --rebase` first. Stay inside the files your issue names.
5. Small commits `#<N> <summary>`, push often to `main`, never push a broken build.
6. **Finish:** confirm your push actually landed on `origin/main` (no `rejected`), then post a
   `DONE by <person> / <agent-id>` handoff with the real commit SHA. Close the issue only when every acceptance criterion
   is met. Unblock dependents and announce on the Coordination issue. COORDINATION.md section 6.
7. **Open new issues freely** for follow-ups, bugs, scope creep, or work in someone else's area: search for duplicates
   first, use the Task template, link the parent, don't self-assign unless claiming (COORDINATION.md section 1).
8. Blocked or unclear spec: comment on the issue, add `blocked`, and stop — don't invent scope.
