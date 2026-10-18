# PaperTrail

> **PaperTrail is all about one thing: saving money you never knew you lost.**

## Elevator pitch

Your inbox already holds the proof of every refund you're waiting on, every return window about to close, and every price drop you could claim. You just never connect the dots. PaperTrail reads your Gmail (read-only), turns every receipt into a ledger row, and uses deterministic rules to find money you're owed. You get one number, **"You're owed $X"**, and every finding comes with the exact email quote that proves it and a drafted claim you approve and send yourself. PaperTrail never sends email and never moves money.

## Inspiration

Everyone has been there: you return a jacket, the store says "5 to 10 business days," and then you forget. A refund comes back short by the shipping fee. A return window quietly closes. Something you bought drops $30 a week later. The money isn't gone because anyone is stealing it. It's gone because the evidence is scattered across a hundred emails and nobody has time to audit their own inbox.

We wanted a tool that does the boring audit for you, and does it in a way you can trust. That second part shaped everything: an AI that "finds money" is useless if it can make up the number.

## What it does

- **Owed to you:** one headline total, with each finding showing a "Why?" that quotes the emails behind it.
- **Purchases:** a searchable ledger of everything we found, with a timeline per purchase: placed, shipped, delivered, returned, refunded.
- **Review:** anything the system isn't sure about waits for a human instead of silently inflating the total.
- **Claims:** an editable drafted message you approve, then copy or open in your own mail client.
- **Promotions:** offers, reward-point balances, expiry dates and copyable promo codes pulled from marketing email.
- **Trust:** an audit log of every Gmail fetch, AI call, approval and delete, plus "delete everything" with a receipt.
- **Quality:** you can mark receipts right or wrong and watch accuracy on your own inbox.

It also handles the messy real-world cases: multiple linked Gmail accounts, the same order arriving as a confirmation, an update and a resent email (merged into one purchase), shipping emails grouped under their purchase, and receipts in other currencies and in Traditional Chinese.

## How we built it

**The core idea: the AI reads, the rules decide.** Claude extracts fields from email text and writes wording. It never produces a dollar figure. Pure, tested functions compute every amount and deadline. Using the notation of our data model, the headline number is

$$\text{owed} = \sum_{f \in F} a_f \quad \text{where } F = \{\, f : \text{status}(f) \in \{\text{open},\text{claim sent}\} \,\wedge\, c_f \ge 0.7 \,\}$$

where $a_f$ is the amount a rule computed for finding $f$, and $c_f$ is the lowest extraction confidence behind it. Anything below $0.7$ goes to Review and stays out of the total until a person confirms it.

**The pipeline:** Gmail (read-only) or an import → a local classifier that filters out marketing and phishing → optional redaction → Claude extraction, validated against a schema (retry once, otherwise Review) → a matcher that groups emails into purchases → deterministic rules for overdue or short refunds, closing return windows and price drops → a ledger and a claim draft.

**Stack:** Next.js (App Router), React, TypeScript, Tailwind, Zod, Drizzle with SQLite, the Claude API, the Gmail API with the `gmail.readonly` scope only, Vitest and Playwright.

**Trust by design:** Gmail access is read-only; claims are copy-to-clipboard or `mailto:` after explicit approval; every AI output is schema-validated; low confidence never counts; and all demo data is synthetic and labeled as such.

### The tools, and what each was for

**Base44, for fast prototyping.** Base44 is an all-in-one stack. We wanted Paper for design and full ownership of our own stack and codebase, so we did not build on it. Instead we used Base44 for what it seemed best at: shipping something fast and well integrated in a snap. We prototyped our UI and basic features there, then used the results as inspiration, taking small code snippets and screenshots and handing them to our own agent. That agent used them to flesh out the design details in Paper.

**Paper, for the design.** Paper was our design source of truth, and the screens in the app trace back to Paper frames: Owed, Purchases, Review, Claim, Trust, Account, Sync, Promotions and a landing page, all two-column on desktop and mobile-first, with a documented design system (slate surface, teal accent, Spectral headings, Hanken Grotesk for UI).

**Devin, for the hard technical parts.** While Paper and Base44 produced the look and feel, the functionality still had to be built. We scoped Devin to what it is good at: intricate technical implementation and complex bug fixes. The organizers ran into trouble distributing Devin tokens, so we used the basic plan to fix complex technical problems, hunt bugs and log issues, and we kept each task self-contained and test-verifiable.

**Our own orchestration: pi, Claude and Codex over GitHub Issues.** Everything above was coordinated by our own agents running on **pi**, with Claude alongside two **Codex** agents. GitHub Issues was the single source of truth, which let us run up to **four independent orchestrators** on the same codebase at the same time, in parallel instead of clashing, and interacting with Devin as one more worker.

What kept four orchestrators from stepping on each other:

- **Claim before work.** An issue is assigned and announced with a plan, the files it touches and an ETA before anyone codes. Earliest claim wins.
- **One owner per file.** The design side (Paper) owned the visual components, styles and design system. The engineering side owned pages, data hooks, backend, Gmail, auth and tests. Nobody edited a file they didn't own, even to fix a build error.
- **Props-only views, thin pages.** Views never fetch data and pages never style, so design and backend could move at the same time with a contract between them.
- **Isolated git worktrees and ports** per worker, small commits to `main`, an `Agent:` trailer on every commit, and a handoff comment with the real commit SHA.
- **Parallel subagents.** One worker per issue, each in its own worktree and dev-server port; the orchestrator reviewed, rebased, tested and merged.
- **Quality gates** before every push: lint, types, unit tests, a production build, and an evaluation gate that must stay green.

Roles: one teammate ran Paper and designed all of the UI and UX. Another managed data, routing and backend through their own orchestrator, reviewed code and supervised Devin. Two more worked on the email side: OAuth, Gmail and extraction.

## Challenges we ran into

### The blue screen

The biggest hurdle was one we never saw coming. About six hours into the event, in the middle of designing the whole frontend, **the computer of the teammate running all of our frontend design was bricked by a blue screen and stayed down for roughly six hours.** Our only Paper instance was on that machine. Without it, we thought we might not be able to design and implement the frontend's styles and appearance at all. And with only two of us in the room, there was no one else to hand it to.

So the other teammate, who was already running their own orchestrator and doing code reviews, installed and ran **a second instance of Paper** and connected a **second pi session** to it. That meant **two orchestrators running in parallel on the same computer**: one for backend and one for Paper. They shared one repository checkout but worked in separate git worktrees, on separate ports, in separate sessions. The file-ownership rules we had already written down are what made it safe. The design session only touched the visual components; the backend session only touched pages, hooks and backend.

With that setup, the two of us worked concurrently on a single machine, shipping functionality and UI/UX at the same time. When the bricked computer was back, the designer rejoined and the redesigns landed in a rush: Owed, Purchases, Trust, Order detail, Claim, Review, Sync, Account, Promotions, mobile navigation and the landing page.

### Making AI trustworthy with money

The hard product problem was trust. Our answer was to keep the AI out of the math completely, validate everything it returns, hold uncertain items for human review, and log every Gmail fetch and AI call.

### Real inboxes are messy

Our own test inbox included point-of-sale receipts in NT$, Shopify orders, campus dining via card processors, Amazon and Whole Foods, and shipping emails in Traditional Chinese. Getting these right meant tuning the classifier and extraction prompt against labels we made ourselves in the app's Quality tab, plus deduplication so one purchase doesn't show up four times.

### Building an agent system as robust as the app

A big part of the work wasn't the product. It was designing an orchestration system sturdy enough that several AIs and several people could build the same codebase at once. Three pieces had to work together:

- **Paper through MCP.** We connected Paper to our coding agents over the Model Context Protocol, so an agent could read the real design frames and implement them as components instead of guessing from screenshots. That meant the design tool became part of the toolchain: each Paper session needed its own checkout, its own dev-server port and a clear boundary, so design agents could only touch visual files. When a Paper session went down, the rest of the system had to keep running.
- **Devin through issues.** Devin doesn't share our local machines or our conversations, so everything it was asked to do had to be written as a self-contained GitHub issue: exact files, acceptance criteria and a command that proves it's done. One orchestrator did the delegation, picking tasks Devin is good at (intricate technical work, bug hunts) and reviewing what came back under the same rules as every other agent.
- **Four parallel orchestrators.** Each orchestrator spawned its own worker agents, and every worker needed isolation. We solved that with the rules above (claims, file ownership, worktrees, ports, commit trailers, handoffs), and then hardened it from what broke: workers killed when a terminal closed (so we added early work-in-progress commits and resume steps), a shared dependency folder that meant one `npm ci` could break everyone (so we stopped all dev servers first), a dev server we promised never to disturb (so workers got their own ports and pushed from worktrees), and an API credit running out mid-task.

The result is that GitHub Issues stayed the single source of truth even as humans, Claude, Codex, Devin and Paper all wrote to the same repository, and the whole history is auditable from claims and `Agent:` trailers on commits.
### Coordination at speed

Agents were killed when a terminal closed, one worker died when an API credit ran out mid-task, and a route-guard change broke three end-to-end tests. Each time, the GitHub issue trail and small commits meant we could resume rather than start over.

## The size and the design we're proud of

PaperTrail is bigger than a typical hackathon project, and we kept it organized the whole way:

- **About 30,000 lines of application code** across hundreds of TypeScript files, plus **about 17,000 lines of tests** in 150+ test files. That's roughly 1,800 automated tests, plus end-to-end browser journeys.
- **About 180 commits and 150 GitHub issues** (most of them closed), each traceable to a person or an agent.
- **40 API routes, 100+ UI component files and a dozen screens**, backed by about 25 documentation files covering the architecture, API, Gmail sync, deduplication, purchase kinds and the design system.
- **A hand-built synthetic inbox** with gold labels, deliberate phishing and marketing traps, and a CI gate on precision and recall, so we can change the extractor without silently making it worse.

What we're proudest of is the design, in both senses of the word:

- **The product design.** A calm, trustworthy interface with a documented system (slate surface, teal accent, Spectral headings for the money, Hanken Grotesk for everything else), a headline number that gets the hero treatment, two-column layouts on desktop and mobile-first navigation. Evidence quotes and confidence are always one tap away, so the design itself says *"here's why you can believe this."*
- **The system design.** A clean pipeline with schemas at every boundary, rules that are pure functions with an injectable clock, a props-only view layer, and an audit trail on every sensitive step. It's the reason four orchestrators and a designer's crashed laptop didn't take the project down.
## Accomplishments we're proud of

- One number you can trust, with an email quote behind every cent of it.
- A strict separation between what the AI reads and what the rules decide.
- Running four parallel orchestrators on one codebase with very few collisions, and surviving a six-hour hardware failure without losing the frontend.
- A reproducible, fully documented agent process: every claim and every commit is traceable to an agent ID on GitHub.
- Over a thousand automated tests, an evaluation gate in CI, and a polished two-column, mobile-first interface.

## What we learned

- **Contracts first.** A props-only view layer and a typed contract between design and data let two people (and several agents) build the same app at once.
- **A single ticket board beats clever prompting.** Claim, own, hand off. The process mattered more than any individual model.
- **Scope the right tool to the right job.** Base44 for speed, Paper for craft, Devin for hard bugs, our own agents for coordination.
- **Be honest about limits.** We measure accuracy on a labeled inbox, and we say plainly where the demo is synthetic.

## What's next

- A **simulated Visa dispute** flow. Visa isn't able to give us developer API access, but said they'd be glad to see the experience simulated, so it will be clearly labeled and move no money.
- Purchase cards tailored to each kind of purchase: shipped orders with tracking, in-store, digital, subscriptions, food and travel.
- A review step for possible duplicate purchases, and support for receipts from payment services.
- Hosted deployment with a persistent database.

## Honest limitations

- Demo data and the price feed are synthetic and labeled "simulated."
- The ledger lives in server memory in this build, so a restart clears it. Accounts, audit entries and quality labels persist in SQLite.
- Our evaluation set is small and synthetic; it does not prove accuracy on every real inbox, which is why we built in-app labeling.
- Approving a claim records your handoff. PaperTrail doesn't verify that you sent it or that the money came back.
- Google sign-in is in testing mode, so only listed test users can connect Gmail.

## Built with

`nextjs` `react` `typescript` `tailwindcss` `zod` `drizzle` `sqlite` `claude` `gmail-api` `paper` `base44` `devin` `pi` `codex` `playwright` `vitest` `github-issues`
