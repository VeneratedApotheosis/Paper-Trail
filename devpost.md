# PaperTrail

> **PaperTrail is all about one thing: saving money you never knew you lost.**

## Inspiration

You return a jacket and the store says "5 to 10 business days." You forget. A refund comes back short by the shipping fee. A return window quietly closes. Something you bought drops $30 a week later. The money isn't stolen; the evidence is just buried across a hundred emails and nobody audits their own inbox.

We wanted a tool that does that audit for you, and that you can trust. An AI that "finds money" is useless if it can invent the number. That shaped everything.

## What it does

- **Owed to you:** one headline total; each finding has a "Why?" that quotes the emails behind it.
- **Purchases:** a searchable ledger with a timeline per purchase (placed, shipped, delivered, returned, refunded).
- **Review:** anything uncertain waits for a human instead of inflating the total.
- **Claims:** an editable draft you approve, then copy or open in your own mail client.
- **Promotions:** offers, reward points, expiry dates and copyable promo codes.
- **Trust:** an audit log of every Gmail fetch, AI call, approval and delete, plus "delete everything" with a receipt.
- **Quality:** mark receipts right or wrong and track accuracy on your own inbox.

It also handles messy real inboxes: multiple Gmail accounts, one order arriving as a confirmation, an update and a resent email (merged into one purchase), shipping emails grouped under their purchase, other currencies and Traditional Chinese.

## How we built it

**The AI reads; the rules decide.** Claude extracts fields from email text. It never produces a dollar figure. Pure, tested functions compute every amount and deadline:

$$\text{owed} = \sum_{f \in F} a_f,\qquad F = \{\, f : \text{status}(f) \in \{\text{open},\text{claim sent}\} \,\wedge\, c_f \ge 0.7 \,\}$$

where $a_f$ is the amount a rule computed for finding $f$ and $c_f$ is the lowest extraction confidence behind it. Below $0.7$, or at a $0 total, an item goes to Review and stays out of the total until a person confirms it.

**Pipeline:** Gmail or import → local classifier (drops marketing and phishing) → optional redaction → Claude extraction, schema-validated (retry once, else Review) → matcher groups emails into purchases → rules find overdue or short refunds, closing return windows and price drops → ledger and claim draft.

**Stack:** Next.js, React, TypeScript, Tailwind, Zod, Drizzle/SQLite, Claude, Gmail API (`gmail.readonly` only), Vitest, Playwright.

**Trust by design:** read-only Gmail; claims are copy or `mailto:` after explicit approval; every AI output is validated; low confidence never counts; all demo data is synthetic and labeled.

### The tools, and what each was for

- **Base44, for fast prototyping.** It's an all-in-one stack, and we wanted Paper for design and full ownership of our own stack and codebase, so we didn't build on it. We used it for what it does best: shipping something fast and well integrated. We prototyped UI and basic features there, then used the results as inspiration, handing small code snippets and screenshots to our own agent, which used them to flesh out every design detail in Paper.
- **Paper, for the design.** Our design source of truth. Every screen traces back to a Paper frame, two-column on desktop and mobile-first, with a documented design system (slate surface, teal accent, Spectral headings, Hanken Grotesk).
- **Devin, for the hard technical parts.** Paper and Base44 gave us the look; the functionality still had to be built. We scoped Devin to what it's good at: intricate technical implementation and complex bug fixes. The organizers had trouble distributing Devin tokens, so we used the basic plan to fix hard technical problems, hunt bugs and log issues, with each task self-contained and test-verifiable.
- **pi + Claude + two Codex agents, coordinated through GitHub Issues.** Our own agents managed all of it. With GitHub Issues as the single source of truth, **up to four independent orchestrators** worked on the same codebase at the same time, in parallel instead of clashing, and treated Devin as one more worker. One teammate ran Paper and all UI/UX; another ran data, routing and backend, reviewed code and supervised Devin; two more handled email (OAuth, Gmail, extraction).

## Challenges we ran into

### The blue screen

About six hours into the event, in the middle of designing the entire frontend, **the computer of the teammate running all our design was bricked by a blue screen and stayed down for roughly six hours.** Our only Paper instance was on it. We thought we might not be able to design the frontend at all, and with two of us in the room there was no one else to hand it to.

So the other teammate, already running an orchestrator and doing code reviews, **installed a second instance of Paper and connected a second pi session to it: two orchestrators running in parallel on one computer**, one for backend and one for Paper. They shared a repository but used separate git worktrees, ports and sessions. The file-ownership rules we'd already written down made it safe: the design session touched only visual components, the backend session only pages, hooks and backend. The two of us shipped functionality and UI/UX concurrently on one machine. When the bricked computer came back, the designer rejoined and the redesigns landed in a rush: Owed, Purchases, Trust, Order detail, Claim, Review, Sync, Account, Promotions, mobile navigation and a landing page.

### Building an agent system as robust as the app

A large part of the work wasn't the product. It was an orchestration system sturdy enough for several AIs and several people to build one codebase at once.

- **Paper through MCP.** We connected Paper to our coding agents over the Model Context Protocol, so an agent could read the real frames and implement them as components instead of guessing from screenshots. Each Paper session needed its own checkout, dev-server port and file boundary, and the rest of the system had to keep working when a session went down.
- **Devin through issues.** Devin doesn't share our machines or conversations, so every task was a self-contained GitHub issue with exact files, acceptance criteria and a command that proves it's done. One orchestrator delegated, chose tasks Devin is good at, and reviewed results under the same rules as every other agent.
- **Four parallel orchestrators.** Each spawned its own workers, so isolation was everything:
  - **Claim before work:** assign the issue and post a plan, files and ETA; the earliest claim wins.
  - **One owner per file:** the design side owned components, styles and the design system; the engineering side owned pages, hooks, backend, Gmail, auth and tests. Nobody edited a file they didn't own, even to fix a build error.
  - **Props-only views, thin pages:** views never fetch and pages never style, so design and backend moved at once.
  - **Isolated worktrees and ports**, small commits to `main`, an `Agent:` trailer on every commit and a handoff comment with the real SHA.
  - **Quality gates** before every push: lint, types, tests, production build and an evaluation gate.
  
  Then we hardened it against what broke: workers killed when a terminal closed (we added early WIP commits and resume steps), a shared `node_modules` where one `npm ci` could break everyone (we stopped all dev servers first), a dev server we couldn't disturb (workers got their own ports and pushed from worktrees), an API credit running out mid-task, and a route-guard change that broke three end-to-end tests.

The result: humans, Claude, Codex, Devin and Paper all wrote to one repository, and the whole history is auditable from claims and `Agent:` trailers.

### Making AI trustworthy with money

We kept the AI out of the math entirely, validated everything it returns, held uncertain items for review, and logged every Gmail fetch and AI call.

### Real inboxes are messy

Our own test inbox had NT$ point-of-sale receipts, Shopify orders, campus dining through card processors, Amazon and Whole Foods, and shipping emails in Traditional Chinese. We tuned the classifier and prompt against labels we made in the app's Quality tab, and added deduplication so one purchase doesn't appear four times.

## The size and design we're proud of

- **About 30,000 lines of application code and 17,000 lines of tests**, in 150+ test files (roughly 1,800 automated tests) plus end-to-end browser journeys.
- **About 180 commits and 150 GitHub issues**, each traceable to a person or an agent.
- **40 API routes, 100+ UI component files, a dozen screens** and about 25 documentation files.
- **A hand-built synthetic inbox** with gold labels, phishing and marketing traps, and a CI gate on precision and recall, so we can change the extractor without silently making it worse.

**Product design:** a calm, trustworthy interface; the owed number gets the hero treatment; evidence quotes and confidence are one tap away, so the design itself says *here's why you can believe this.*

**System design:** schemas at every boundary, rules as pure functions with an injectable clock, a props-only view layer and an audit trail on every sensitive step. It's why four orchestrators and a bricked laptop didn't sink the project.

## Accomplishments

- One number you can trust, with an email quote behind every cent.
- A strict split between what the AI reads and what the rules decide.
- Four parallel orchestrators on one codebase with few collisions, and a six-hour hardware failure survived without losing the frontend.
- A documented, reproducible agent process: every claim and commit traces to an agent ID on GitHub.

## What we learned

- **Contracts first.** A props-only view layer and typed contracts let people and agents build the same app at once.
- **One ticket board beats clever prompting.** Claim, own, hand off.
- **Right tool, right job.** Base44 for speed, Paper for craft, Devin for hard bugs, our own agents for coordination.
- **Be honest about limits.**

## What's next

- A **simulated Visa dispute** flow. Visa can't give us developer API access but said they'd be glad to see it simulated, so it will be clearly labeled and move no money.
- Purchase cards per kind: shipped with tracking, in-store, digital, subscription, food, travel.
- A review step for possible duplicates, and receipts from payment services.
- Hosted deployment with a persistent database.

## Honest limitations

- Demo data and the price feed are synthetic and labeled "simulated."
- The ledger lives in server memory, so a restart clears it; accounts, audit and quality labels persist in SQLite.
- Our evaluation set is small and synthetic, which is why we built in-app labeling to measure real inboxes.
- Approving a claim records a handoff; PaperTrail doesn't verify that you sent it or got paid.
- Google sign-in is in testing mode, so only listed test users can connect Gmail.

## Built with

`nextjs` `react` `typescript` `tailwindcss` `zod` `drizzle` `sqlite` `claude` `gmail-api` `paper` `base44` `devin` `pi` `codex` `playwright` `vitest` `github-issues`
