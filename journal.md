# PaperTrail build journal (Devpost source notes)

Purpose: context for writing the Devpost and for handing to other models. The README is the technical reference; this file is the story, the numbers and the claims we can back up. Facts below come from the repo, git history and GitHub issues. Items marked **(Kenan)** are his account and should be kept as he tells them.

## One-line pitch
**PaperTrail saves you money you never knew you lost.**

Elevator version: your inbox already holds every receipt, return confirmation and refund notice. PaperTrail reads Gmail (read-only), turns each purchase into a ledger row, and uses deterministic rules to find money you're owed: refunds that are overdue or short, return windows about to close, price drops. You get one number, "You're owed $X". Every finding comes with the email quote that proves it, a confidence score, and a drafted claim you approve and send yourself. We never send email and never move money.

## What it does (for the "What it does" section)
- **Owed to you:** one headline total, findings with a "Why?" showing source quotes.
- **Purchases:** a searchable ledger built from receipts, with timelines per purchase.
- **Review:** uncertain extractions (confidence below 0.7) are held out of the total until a human confirms.
- **Claims:** an editable drafted message, approved by the user, copied or opened in their own mail client.
- **Promotions:** offers, expiry dates and copyable promo codes from marketing email.
- **Trust:** audit log of every Gmail fetch, LLM call, approval and delete; merchant exclusions; "delete everything" with a receipt.
- **Quality:** the user marks real receipts right or wrong; we track accuracy on their own inbox.
- Multiple linked Gmail accounts, duplicate-email merging, purchase kinds (shipped, in-store, digital, subscription, food, travel), tracking emails grouped under their purchase (English and Traditional Chinese), a "Not a purchase" flag that survives re-syncs.

## Design decisions worth telling
1. **Numbers come from rules, never from the AI.** Claude extracts fields and writes wording; pure functions compute every amount and deadline. This is why the total is trustworthy.
2. **Every AI output is schema-validated** (Zod), retried once, then sent to Review. Nothing is silently dropped.
3. **Read-only by construction:** Gmail scope is `gmail.readonly` only; claims are copy or `mailto:` after explicit approval.
4. **Low confidence never inflates the total.**
5. **Honest evaluation:** a synthetic gold-labeled inbox (with phishing and marketing traps) gates CI on precision and recall; we say plainly that this does not prove accuracy on real inboxes, then added the in-app Quality labeling to measure that on a real one.
6. **Privacy posture:** redaction (cards, phones, addresses) exists and is on/off by `PAPERTRAIL_REDACT`. For the local demo we turned it off by default so Claude can read tracking numbers and similar details, and the app says so. Decision recorded on issue #28.
7. **Visa:** Visa declined to provide a developer API but said they'd like to see the feature simulated. Plan: a clearly labeled "simulated Visa dispute" flow that moves no money (not built at the time of writing; check the issues before claiming it).

## By the numbers (as of writing)
- ~173 commits; ~149 GitHub issues, ~136 closed; about 460 source files.
- ~1,700+ automated tests (vitest) plus Playwright journeys; lint, typecheck, build and an eval gate in CI.
- Seed demo: 14 findings totalling **$1,774.23**, all synthetic and labeled.
- Commit authorship by agent family (from `Agent:` trailers): pi orchestrators (kenan-pi, alex-pi, alex-pi-ui), Paper sessions (alex-paper), Codex (chelsea-codex, ethan-codex), Devin (kenan-devin).
- Run `git log --format="%h %an | %s | %(trailers:key=Agent,valueonly,separator=%x2C)"` to regenerate.

## How we built it: the tool story

### 1. Base44 for fast prototyping **(Kenan)**
Base44 is an all-in-one stack. We wanted Paper for design and full ownership of our own stack and codebase, so we did not build on Base44. We used it for what it is best at: shipping something fast and well integrated. We prototyped and tested UI and basic features there, then used the result as inspiration: small code snippets and screenshots handed to our own agent, which used them to flesh out the design details in Paper.

### 2. Paper for design
Paper was the design source of truth: all-screens baseline, two-column desktop layouts, mobile-first, and a documented design system (`docs/design-system.md`: slate surface, teal accent, Spectral headings, Hanken Grotesk UI text). Alex drove Paper; his agents turned Paper frames into props-only React views.

### 3. Devin for the hard technical parts **(Kenan)**
While Paper and Base44 produced the frontend look, the functionality was still unbuilt. We scoped Devin to what it is good at: intricate technical implementation and complex bug fixes. The organizers had trouble distributing Devin tokens, so we used the basic plan to fix complex technical problems, hunt bugs and log issues. Devin work shows up in git as `kenan-devin-*` (about ten commits) and in the delegation list in `COORDINATION.md` (PWA, typed Gmail client docs, security hardening, test hardening).

### 4. Our own orchestration: pi + Claude + Codex, GitHub Issues as the single source of truth **(Kenan, expanded)**
Everything above was coordinated by our own agents running on **pi**, with Claude alongside two **Codex** agents. GitHub Issues was the ticketing system and the only live status board. That let up to four independent orchestrators work on the same codebase in parallel without clashing, interacting with Devin as one more worker.

How it stayed sane (all written down in `AGENTS.md` and `COORDINATION.md`):
- **Claim before work:** assign yourself and post `CLAIMED by <person> / <agent-id>` with plan, files and ETA; earliest claim wins.
- **One owner per file.** Alex's Paper side owns `src/components/**`, styles and the design system; Kenan's side owns pages (thin wrappers), hooks, backend, auth, Gmail, DB, seed and tests. Nobody edits a file they don't own, even to fix a build error.
- **Views are props-only; pages are thin.** That contract is what let design and data move in parallel: Alex's views never fetch, Kenan's pages never style.
- **Interface changes** are announced in `INTERFACE` comments; shared contracts (`src/lib/contracts`) need Kenan's OK.
- **Isolated git worktrees and ports per worker**, pushing small commits to `main`, with an `Agent:` trailer on every commit and a `DONE` comment carrying the real SHA.
- **Subagents:** the orchestrator spawned parallel worker agents (one per issue) in separate worktrees, each with its own dev-server port, and reviewed, rebased, tested and merged their work.
- **Quality gates before every push:** lint, typecheck, vitest, production build; the seed pipeline (14 findings, $1,774.23) and eval gate must stay green.
- **Agent usage log:** because every claim and commit carries an agent ID, the whole AI-assisted history can be rebuilt from GitHub (see `COORDINATION.md` section 12).

Roles: Alex ran Paper and designed all of the UI/UX. Kenan managed data, routing and backend through his orchestrator, did code review, and supervised Devin. Chelsea (via Codex) took reserved queues covering OAuth/Gmail, tests, docs and polish. Ethan was on the team early on (Codex agent, one commit). **(Kenan says Chelsea and "Elo" did the email work; the repo shows Chelsea's Codex on OAuth/Gmail and Ethan's on one commit. Reconcile before publishing.)**

## The big obstacle: Alex's computer blue-screens mid-event **(Kenan)**
About six hours into the event, in the middle of designing the entire frontend, Alex's computer blue-screened and stayed down for roughly six hours. Without his Paper instance we thought we couldn't finish the visual design at all. Only Kenan and Alex were physically there.

What we did: Kenan, already running his own orchestrator and doing code reviews, installed and ran his **own Paper instance** on his computer and connected a **second pi session** to it. Two orchestrators, one for backend and one for Paper, ran in parallel on the same machine, sharing one checkout of the repo but working in separate worktrees and ports (3000 for the real app, 3300 for the design session). That let Kenan and Alex work at the same time on a single computer, shipping functionality and UI/UX together. The file-ownership rules above are what made it safe: the design session only touched `src/components/**`, the backend session only touched pages, hooks and backend.

When Alex's machine came back (2026-10-18) he rejoined as `alex-paper-*` and the redesigns landed: Owed, Purchases, Trust, Order detail, Claim, Review, Connect, Sync, Account, Promotions, mobile navigation and a landing page, all two-column on desktop and mobile first.

Other bumps worth a line: parallel agents were killed when a terminal or editor was closed (we added WIP commits and resume steps); a worker died when the API credit ran out mid-task; GitHub Actions end-to-end checks broke after the landing-page route guard (signed-out visitors now go to `/welcome`) and we removed three stale specs.

## Challenges the product itself had
- Real inboxes are messy: Shopline/POS receipts in NT$, Shopify, campus dining via card processors, Amazon/Whole Foods, plus tracking emails in Traditional Chinese. We tuned the classifier and prompt from the author's own labels in `/eval` and added deduplication so confirmation, update and resent emails collapse into one purchase.
- Trust: ensuring the AI can never invent the number. Hence rules-only math and schema validation.
- Speed: Gmail sync was paced, cached and streamed with progress; a Promotions pass was added as a separate small query.

## Sponsor and tracks
- **Paper** (Best Designed Hack): custom polished frontend designed in Paper, with a documented design system.
- **Visa** (Future of Shopping): money-back and dispute flow; Visa API not available, so any dispute feature is explicitly simulated and labeled.
- **Devin:** used under supervision for hard implementation and bug hunting (see above); not a primary target (the Cognition prize target was dropped on 2026-10-17, Devin itself came back on 2026-10-18).
- Base44 was used only for prototyping, not as the app's stack.

## What's next
Review "Possible duplicates" card and payment-service receipts; purchase cards per kind (Alex, #128); simulated Visa dispute; hosted deployment (needs a persistent server and disk, not static hosting, since the ledger is in memory and auth uses SQLite); license choice; live OAuth edge-case checks (#102).

## Honest limitations (say these; judges trust them)
- Demo data and the price feed are synthetic and labeled "simulated".
- The ledger is in process memory; a restart loses it. SQLite stores auth, audit and quality labels.
- The synthetic eval is small and was visible during development; it does not prove real-inbox accuracy.
- Claim approval records a handoff; the app does not verify the email was sent or the money returned.
- Google OAuth runs in Testing mode, so only listed test users can connect Gmail.

## Devpost field cheat-sheet
- **Inspiration:** people lose money on late refunds, expiring return windows and price drops because proof is buried in email.
- **What it does:** see above.
- **How we built it:** Next.js 15, React 19, TypeScript, Tailwind, Zod, Drizzle/SQLite, Claude for extraction and wording, Gmail API (read-only). Designed in Paper, prototyped in Base44, hard problems with Devin, orchestrated with pi, Claude and Codex over GitHub Issues.
- **Challenges:** messy real receipts; keeping AI out of the math; the blue-screen story.
- **Accomplishments:** one number backed by evidence; four parallel orchestrators without clashes; a documented, reproducible agent process.
- **What we learned:** file ownership and a single ticket board make parallel agents safe; contracts first (props-only views) lets design and data move at once.
- **Built with:** nextjs, react, typescript, tailwindcss, zod, drizzle, sqlite, anthropic-claude, gmail-api, paper, base44, devin, pi, codex, playwright, vitest.
