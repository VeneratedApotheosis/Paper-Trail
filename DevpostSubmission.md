# PaperTrail — Devpost Submission

## Elevator pitch

Stores owe you money after every purchase. Overdue refunds, closing return windows, price drops. The proof hides across hundreds of emails, and no store adds it up for you. PaperTrail turns your inbox into one ledger, finds the money, cites the exact email, and drafts the claim you approve. You stop losing money after checkout.

## Inspiration

You lose money after every checkout and never notice. A refund gets approved but never lands. A refund comes back a few dollars short. A 30-day return window closes while the box sits in your hallway. A price drops a week after you buy, and the store's price-adjustment window is still open.

The evidence already sits in your inbox. Order confirmations, shipping notices, refund emails, return labels. Nobody reads them side by side. We wanted one honest number: how much stores owe you right now, with proof for each dollar.

## What it does

PaperTrail reads your shopping email with read-only access. Every purchase becomes a ledger row. Deterministic rules scan your orders and find money you are owed:

- **Refunds owed:** a return arrived but no refund came within the SLA, or the refund came back short.
- **Return deadlines:** the return window closes within 7 days and no return has started.
- **Price drops:** the current price fell by at least $\max(\$5,\ 5\%)$ while the adjustment window stays open.

Each finding cites the exact source email, the rule, and a confidence score. Then you get a drafted claim. You review, approve, and send it yourself. The app never sends email and never moves money.

## How we built it

- **Stack:** Next.js (App Router), TypeScript, Tailwind, Framer Motion. Drizzle ORM on SQLite. Zod for every schema.
- **Pipeline:** `prefilter → classify → redact → extract → match → rules → findings → claim drafts`.
- **Classification** runs first on raw email with local deterministic code. No model sees marketing mail.
- **Redaction** replaces card numbers, phones, addresses, and emails with tokens before any model call.
- **Extraction** uses Claude through a tool call, validated by Zod, retried once, and cached by hash. Invalid output or confidence below 0.7 goes to a review queue instead of your total.
- **Rules** are pure functions with the clock injected. Numbers come from rules, never from the model. The model only extracts fields and rewords drafts, and a fact check rejects any reword that changes a number.
- **Audit** logs every Gmail fetch, model call, approval, and delete.

Three sources feed one pipeline: live Gmail sync, a synthetic seed inbox, and `.eml` / `.mbox` upload.

## What makes it different

PaperTrail solves a problem you cannot solve alone. No single store shows you the full picture. We pull scattered signals across every merchant into one ledger and one owed total. This is a full system for post-purchase money recovery, not a chat wrapper.

## What we learned

- Trust is a feature. Read-only scope, redaction, an audit log, and a live "delete everything" button changed how people reacted to the demo.
- Keeping numbers out of the model made results stable and defensible. The model writes words; rules compute dollars.
- Caching and a fixture client let us build and test offline without burning API calls or waiting on network.
- Email is messy. HTML tables, forwarded headers, and international formats break naive parsers.

## Challenges we faced

- **Gmail restricted scope.** `gmail.readonly` keeps you in Testing mode with a 100 test-user cap and 7-day token expiry. We built a demo mode and upload path so the product works without a login.
- **Parsing accuracy.** We labeled a gold set with edge cases and held some out. We report field-level and finding precision and recall, and route low-confidence items to review.
- **Redaction precision.** Early passes stripped dates and reference IDs tangled with customer names. We fixed the false positives so claims keep the facts they need.
- **Honest totals.** We keep approved claims counted until resolved, never add different currencies together, and round to cents to avoid float noise.
- **Coordination.** A small team of humans and agents shipped in parallel using strict file ownership and GitHub Issues as the only status board.

## What's next

- Rewards and loyalty balances with expiry.
- Wishlist price comparison.
- Dedupe across accounts and purchase-specific cards for travel, subscriptions, and in-store buys.
