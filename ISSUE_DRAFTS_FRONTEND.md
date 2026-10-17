# Draft issues: missing frontend screens

Not yet created on GitHub. Follows `.github/ISSUE_TEMPLATE/task.md`. Screen numbers refer to `scope_features.md` §3.
Design guidance for all three: `frontend-design-skill.md`, tokens from #9. Build against mocked API responses until the backend lands.

---

## Draft A: Connect + consent explainer screen
**Labels:** `L1-core`, `frontend`, `design`

## Goal
Build the first screen: explain exactly what Gmail access PaperTrail asks for before the Google redirect, and offer demo mode as an alternative.

## Directory/files
- `/src/app/connect/page.tsx`
- `/src/components/ConsentExplainer.tsx`, `/src/components/WillNotList.tsx`

## Acceptance criteria
- [ ] Shows the single scope requested (`gmail.readonly`) in plain language
- [ ] "What PaperTrail will NOT do" list: send mail, move money, store full card numbers, read non-receipt mail, share data
- [ ] Heads-up about Google's "unverified app" warning and the steps to continue (Advanced, then Go to app)
- [ ] Primary action "Connect Gmail" starts the flow from #3; secondary action "Try demo data" starts demo mode from #4
- [ ] Clear message for a non-test-user (`access_denied`) and for an expired 7-day token with a re-consent action
- [ ] Keyboard focus visible, responsive to mobile, follows #9 tokens

## Dependencies
#1, #9. Wires to #3 and #4 (mock the actions until they land).

## Estimate
2h

## References
`scope_features.md` F1.1, §3 screen 1, §6; `deepdive_S14.md` §5

---

## Draft B: Sync preview and progress screen
**Labels:** `L1-core`, `frontend`

## Goal
Show the user what a sync will touch before it runs, then show named-stage progress while it runs.

## Directory/files
- `/src/app/sync/page.tsx`
- `/src/components/SyncPreview.tsx`, `/src/components/SyncProgress.tsx`

## Acceptance criteria
- [ ] Before the first run: the Gmail query used, the message count, and the cap (90 days, up to 300 messages)
- [ ] During the run: stage names (fetch, redact, classify, extract, match, rules), running counts, redacted-token count
- [ ] Cancel button; the run is resumable after a 429 backoff, with a visible "waiting" state
- [ ] Manual "Sync now" action available from the ledger
- [ ] Ends by routing to the hero (#16), or to an empty state (see Draft C) if no receipts were found
- [ ] Reduced-motion respected

## Dependencies
#1, #9, #3 (real data). Can use mocked progress events first.

## Estimate
2-3h

## References
`scope_features.md` F1.9, §3 screen 2; `deepdive_S14.md` §2

---

## Draft C: System states (empty, error, loading, demo banner)
**Labels:** `L1-core`, `frontend`, `design`

## Goal
Design and build the shared non-happy-path states so every page handles them consistently.

## Directory/files
- `/src/components/states/` (`EmptyState`, `ErrorState`, `Skeleton`, `TokenExpired`)
- `/src/components/DemoBanner.tsx` (shared with #4)

## Acceptance criteria
- [ ] Empty inbox / no receipts found: shows the query used, offers demo mode and `.eml` import; never shows "$0 owed" as a success without context
- [ ] Nothing-owed state for the hero, distinct from empty inbox
- [ ] Error states say what went wrong and how to fix it, with no apology or vague wording
- [ ] Loading skeletons for ledger, hero, and order detail
- [ ] Token-expired state with a re-consent action
- [ ] Demo banner reads "Demo data — synthetic" and shows on every page in demo mode
- [ ] Used by #10, #11, #12, #16, #17 in place of one-off versions

## Dependencies
#9. Should land before or alongside #10 and #16.

## Estimate
2h

## References
`scope_features.md` §3 screen 12, §4; `frontend-design-skill.md` (writing for failure and emptiness)

---

## Optional: cover image
Not a GitHub issue. A design task for the Paper owner: the torn-receipt cover with the headline number, for Devpost. Track it in `plan.md` §4 under Paper.
