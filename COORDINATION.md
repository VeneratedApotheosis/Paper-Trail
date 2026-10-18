# COORDINATION.md — Claiming, Tracking & Team/Agent Coordination

How humans and AI agents work together on PaperTrail without stepping on each other.
- **GitHub Issues is the only live status board.** Who is doing what, progress, blockers, and what's done all live there.
- **This file holds the rules.** Don't use repo files (STATUS.md, TODO.md, code comments) to coordinate.
- **Everyone works on `main`** (trunk-based). No long-lived branches.

Repo: `VeneratedApotheosis/Paper-Trail`

---

## 0. Team and ownership

| Person | GitHub | Owns |
|---|---|---|
| **Kenan** | `VeneratedApotheosis` | Repo owner, final say on scope. **Data + routing:** thin pages, middleware, hooks, backend. Orchestrated `kenan-pi-*` agents (section 5) |
| **Alex** | `ptatoo` | **How it looks:** design system, styles, visual components and views (Paper) |
| Ethan Lowe | `ethanwlowe7-cmyk` | **On the team but inactive (no time to code, 2026-10-17).** Any claim by him is stale and may be taken over immediately (comment that it's stale, then claim). Don't assign him work |
| Chelsea | `chelsearwang` | **On the team but inactive (left the hackathon, 2026-10-17).** Any claim by her is stale and may be taken over immediately. Her area (auth, Gmail, review, DB) is now Kenan's. Don't assign her work |

### The frontend is split by file (decided 2026-10-17)
**Alex = how it looks. Kenan = where data comes from and where users go, plus auth, Gmail, review and DB while Chelsea is inactive.**
Every file has exactly one owner. Never edit, refactor, reformat, or "fix" a file you don't own, even if a build error
points there: tell the owner (issue comment + tag).

> **Temporary (2026-10-17):** Alex's computer crashed. While he's down, Kenan's agents may make the view fixes listed in
> **#101** in `src/components/**` (only those, keeping Alex's visual style; each change posted on #101 for his review).

| Owner | Label | Files |
|---|---|---|
| **Alex** | `ui-design` | `tailwind.config.*`, `src/app/globals.css`, `src/styles/**`, `public/**`, Paper files, `docs/design-system.md`, `src/components/**` (visual components + views in `src/components/views/**`), `src/lib/format.ts` |
| **Kenan** | `ui-wiring`, `backend` | `src/app/**/page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, route groups/redirects, `middleware.ts`, `src/hooks/**`, `src/app/layout.tsx` (providers/metadata/mode only; renders Alex's `<AppShell>`), `src/lib/{api,store,pipeline,demo,claims,rules,ingestion,orders,prices,eval,llm,contracts}/**`, `src/app/api/**` except auth/gmail/review, `src/app/api/debug/**`, legacy `src/lib/types.ts` + `src/lib/view.ts` (being moved into contracts/backend), `seed/**`, `scripts/**`, `tools/**`, `e2e/**` |
| **Kenan** (from Chelsea, inactive) | `backend` | `src/lib/auth/**`, `src/app/api/auth/**`, `src/lib/gmail/**`, `src/app/api/gmail/**`, `src/lib/review/**`, `src/app/api/review/**`, `src/db/**` (Chelsea's code: change carefully, keep her tests passing) |

**Shared contracts:** `src/lib/contracts/**` is Kenan's, but everyone builds on it: post an `INTERFACE` comment and wait
for an OK from Kenan before changing it. Changes to another owner's files (e.g. store scoping in `src/lib/store`) need the
same: INTERFACE on that owner's issue + OK, not only a #28 post.

Rules:
1. **Views are props-only.** Nothing in `src/components/**` may `fetch` or import `@/lib/api`, `@/lib/store`,
   `@/lib/mock`, `@/lib/auth`, or do routing/redirect logic. Props are typed with `@/lib/contracts` (NormalizedOrder,
   Finding, OwedSummary, Draft, ...); user actions are callbacks (`onApprove`, `onExclude`, `onLoadDemo`, ...).
2. **Pages are thin.** `page.tsx` gets data (server-side helpers or `src/hooks/**` on `@/lib/api/client`) and renders a
   view with props. No styling, no new markup beyond composing views. Business logic (owed total, order status,
   rounding, needs-review) lives in the backend, not in views.
3. **Per page, in order:** (1) Alex's agent moves the page's markup into `src/components/views/<Name>View.tsx`
   (`ui-design` issue, DONE with SHA), then (2) Kenan's agent wires `page.tsx` to real data (`ui-wiring` issue,
   blocked until step 1 is done). Never both on the same page at the same time.
4. **Design previews** use sample props in `src/components/**/fixtures/`, never in pages. `src/lib/mock/**`,
   `src/lib/types.ts` and `src/lib/view.ts` are legacy and are retired as pages get wired.
5. **Auth guards and demo-vs-Gmail mode** live in `middleware.ts` / page wrappers (Kenan), using Chelsea's session helper.
6. Need a visual change? Open a `ui-design` issue for Alex. Need data or a route? Open a `ui-wiring` issue for Kenan.
   Changing a schema, type, API, or view props others use: post an `INTERFACE` comment and tag the owner first.
7. Claim, relabel, reassign, or close only issues in your own area (or ones you opened). Commenting anywhere is fine.

---

## 1. Identify yourself (every agent, every session)
Several agents can post from the **same GitHub account** (e.g. all of Alex's agents post as `ptatoo`).
The assignee shows the **human**; the **agent ID** in comments shows which agent.

**Agent ID format:** `<person>-<tool>-<n>`, e.g. `kenan-pi-1`, `alex-pi-ui-2`, `chelsea-codex-1`.
- Pick it at session start. If your operator didn't give you one, use `<person>-<tool>-1`; if that ID already has an
  open claim that isn't yours, increment `n`.
- Put the agent ID in **every** comment you post (claims, progress, handoffs).
- Humans working by hand use just their name (e.g. `chelsea`).

### Opening new issues (anyone, human or agent, may and should)
New work, a discovered bug, a follow-up, scope creep, or the other half of a split issue -> **open a new issue**.
This is encouraged, especially when coordinating with other people's agents. Rules:
1. **Search first** to avoid duplicates: `gh issue list --state all --search "<keywords>"`.
2. Use the **Task template** shape (Goal, Directory/files, Acceptance criteria, Dependencies, Ref). Add layer + area labels.
3. **Link it:** reference the parent/related issue (`follow-up of #21`, `backend half of #17`) and comment the new
   number on the parent so the trail is visible from both sides.
4. **Opening is not claiming.** Leave it unassigned unless you're claiming it now (then follow section 4).
5. Work in someone else's area (e.g. a UI change for Alex, an OAuth change for Chelsea): open it, label it
   (`frontend`, ...), tag the owner, and **leave it for them**.
6. If it affects others (blocks them, changes an interface, adds a dependency), also post a one-liner on #28.
7. Close an issue you opened only when its work is done, or as `not planned` with a reason (e.g. superseded).
   Never close someone else's issue.

---

## 2. Issue states: how to tell who is doing what

| State | How it looks on GitHub | Meaning |
|---|---|---|
| **Available** | open, **no assignee**, no `blocked` label | Anyone whose area it is (section 0: `ui-design` = Alex, `ui-wiring` = Kenan) may claim it |
| **In progress** | open, **assigned**, has a `CLAIMED` comment | Someone is on it. Don't touch it |
| **Blocked** | open, `blocked` label | Waiting on another issue/external thing (see latest comment) |
| **Done** | **closed**, with a `DONE` handoff comment | Finished. Code is on `main` |

The assignee is the single source of truth for "taken". **Assigned = taken**, even if the claim comment is missing.

---

## 3. Session start checklist (run before doing anything)
```powershell
# 1. What am I already doing? (resume your own work first)
gh issue list --assignee @me
gh search issues "<your-agent-id>" --repo VeneratedApotheosis/Paper-Trail --state open

# 2. Who is doing what? (one line per teammate)
gh issue list --assignee ptatoo
gh issue list --assignee VeneratedApotheosis

# 3. What's available, blocked, finished?
gh issue list --search "no:assignee -label:blocked"
gh issue list --label blocked
gh issue list --state closed --limit 30

# 4. Latest team-wide announcements (pinned Coordination issue #28)
gh issue view 28 --comments
```
If you already have an open claim with your agent ID, **continue that work** before claiming anything new.

---

## 4. Claim BEFORE you work (mandatory)
**No claim on GitHub = no work.** Don't create a worktree, write code, or open a PR until the claim is posted.

1. Read it: `gh issue view <N> --comments`
2. Check it's **yours to take**:
   - **unassigned** and no active `CLAIMED` comment. Read **every** comment: a claim can exist as a comment
     without an assignee (e.g. the claimer lacked assign permission). A comment-only claim still counts.
   - **in your area** (section 0 file ownership; `ui-design` = Alex, `ui-wiring` = Kenan), or opened for you
   - **unblocked**: every issue under "Dependencies" is closed
3. Claim it, both steps:
   ```powershell
   gh issue edit <N> --add-assignee @me
   gh issue comment <N> --body-file claim.md
   ```
   `claim.md`:
   ```
   CLAIMED by <person> / <agent-id>
   Plan: <1-3 lines>
   Files I expect to touch: <paths>
   ETA: <rough hours>
   ```
4. **Re-check right after** (`gh issue view <N> --comments`). If another claim was posted first,
   **the earliest `CLAIMED` comment wins**. Delete your comment, unassign yourself (if not shared), and pick another.
5. Only now start work.

Rules:
- **One active issue per agent** at a time (an ingestion chain like #6→#7→#8 is claimed one issue at a time).
- **One owner per issue.** Want to help? Ask the owner in a comment first.
- Splitting an issue (e.g. frontend vs backend half): if the other half belongs to someone else (e.g. Alex owns the
  UI half), **open a separate issue for your half** titled `Backend: ... (#N backend half)` and claim that instead of
  touching their issue (examples: #31, #32). If the whole issue is yours, say which half in the claim (`Scope: backend only`).
- **Inactive or departed members:** claims by people marked inactive or gone in section 0 are stale immediately. Comment
  `Claim by @user is stale (inactive)`, then post `CLAIMED (takeover) by ...`. No 4-hour wait.

---

## 5. Keep the issue updated while working
The issue is how everyone (humans and agents) knows what's happening. Always include your agent ID.

| When | Comment starts with | Contents |
|---|---|---|
| Every ~2h or at each milestone | `PROGRESS (<agent-id>)` | What's done, what's next, commits pushed |
| You make a decision others should know | `DECISION (<agent-id>)` | The choice and why |
| You change a schema/type/API others use | `INTERFACE (<agent-id>)` | Exact change + tag who depends on it (e.g. `@ptatoo`) |
| You're stuck | `BLOCKED (<agent-id>)` | What you're waiting on (`blocked by #8`). Also add the `blocked` label |
| Unblocked | `UNBLOCKED (<agent-id>)` | Remove the `blocked` label |
| You stop before finishing | `UNCLAIMED (<agent-id>)` | State of the work + what's left. Then `gh issue edit <N> --remove-assignee @me` |

Marking blocked / unblocked:
```powershell
gh issue edit <N> --add-label blocked
gh issue edit <N> --remove-label blocked
```

**Orchestrated agents:** one orchestrator agent may claim, update, and close issues on behalf of worker agents it runs
(workers commit in their own worktrees; the orchestrator reviews, pushes, and posts). Name both IDs, e.g.
`DONE by kenan / kenan-pi-4 (reviewed + pushed by kenan-pi-1)`. Workers never post or push on their own.

**Stale claims:** a claim with no comment or commit for **4+ hours** may be taken over. Comment on the issue tagging the
owner, wait ~15 minutes, then claim with `CLAIMED (takeover) by ...`. Never take over an issue in someone else's area (section 0); ask its owner.

**Scope creep:** don't expand an issue. File a new issue (Task template) and link it.
**Spec unclear:** comment the question, tag the owner or `@VeneratedApotheosis`, and don't guess on product rules.

---

## 6. Finishing: DONE handoff + close
When every acceptance criterion is met and the code is pushed to `main`:
```
DONE by <person> / <agent-id>
- What changed: <summary>
- Files: <main paths>
- Interfaces changed: <types/APIs/schema others depend on, or "none">
- How to verify: <command or steps>
- Follow-ups: #<new issue> (or "none")
```
**Verify the push landed before posting DONE or closing.** The `git push` output must show `<old>..<new>  ... -> main`
and no `rejected`; confirm with `git log origin/main -1`. If the push was rejected: `git pull --rebase`, re-run checks,
push again. Never close an issue whose code isn't on `main`. Put the real commit SHA in the DONE comment.

Then close it: `gh issue close <N> --comment "Closed, see DONE above"` (or put `Closes #<N>` in the final commit).
If anything is unchecked, don't close it. Comment what's left, or file a follow-up issue.

**Unblock others:** after closing, check which issues listed yours as a dependency, remove their `blocked` label if
nothing else blocks them, and post a one-liner on the pinned Coordination issue (e.g. `#1 scaffold is on main, pull now`).

---

## 7. Pinned Coordination issue #28 (team-wide channel)
Issue **#28**, pinned, titled **"📌 Coordination channel"** is for announcements that don't belong to a single task:
- "scaffold landed, pull now", "schema changed in `src/db/schema/orders.ts`"
- "adding dependency X" (post **before** adding it)
- "pushing a risky change in 10 min", "main is broken, fixing"

Comment there with your agent ID. Read its latest comments at every session start.

---

## 8. Git workflow (shared `main`)

### Golden rules
1. **One working folder per writer.** Each human and each local agent uses its own clone or `git worktree`.
   Two agents in the same folder will overwrite each other. Never do this.
2. **Pull before you start, and before you push:** `git pull --rebase`
3. **Commit small, push often:** every 30–60 min of work, not one giant push.
4. **Never push a broken build.** `npm run lint`, `npm run typecheck`, `npm test` must pass first.
5. **Never force-push `main`.** Never rewrite pushed history.
6. Stage specific files (`git add <paths>`), not `git add .` blindly. Check for secrets first.
7. **Pushing to `main` once lint/typecheck/test pass is the normal workflow.** No PR or extra approval is needed
   If an agent's tooling asks for explicit push approval, its human operator gives it.

### Typical loop
```powershell
git pull --rebase
# ...make a small, working change...
npm run lint; npm run typecheck; npm test
git add <specific files>
git commit -m "#6 add PAN redaction to prefilter"
git pull --rebase
git push
```

### Local agents in parallel (worktrees)
Git won't check out `main` in two folders at once, so each worktree gets a local scratch branch that pushes straight to `main`:
```powershell
git fetch origin
git worktree add -b wip/6 ../pt-issue-6 origin/main   # separate folder for the agent working on #6
cmd /c mklink /J ..\pt-issue-6\node_modules node_modules   # optional: share deps instead of reinstalling
cd ../pt-issue-6
# ...work + commit...
git pull --rebase origin main
git push origin HEAD:main                              # lands on shared main
# when the issue is done (from the main checkout):
cmd /c rmdir ..\pt-issue-6\node_modules              # FIRST remove the junction (deletes the link only)
git worktree remove ..\pt-issue-6; git branch -D wip/6
```
**Warning:** never `git worktree remove --force` (or `Remove-Item -Recurse`) a worktree that still has a
`node_modules` junction. It follows the link and deletes the main checkout's `node_modules`.
Remove the junction with `cmd /c rmdir` first. Worker agents must never run `npm install`/`npm ci` in a junctioned worktree.
The `wip/*` branch is local only. Never push it as its own branch.

### Merge conflicts
- Rebase conflict: resolve, `git add`, `git rebase --continue`. If unsure, `git rebase --abort` and ask the file's owner.
- Barrel files (`index.ts` re-exports, e.g. `defaultRules` in `src/lib/rules/index.ts`) conflict often when two issues
  each append a line. Keep **both** sides' additions, then re-run all checks.
- After resolving a conflict in a cherry-pick/rebase, check the commit message survived (`git log -1 --format=%B`)
  **before** pushing. Pushed history is never rewritten, so a lost message can only be corrected in an issue comment.
- Agents: **don't resolve conflicts in files outside your issue by guessing.** Stop and comment on the issue.
- Conflict in a file you don't own: keep the owner's version and tell them.

### Short-lived branches
Humans may use a short-lived branch only for risky changes (schema rewrite, big refactor): finish and merge within the hour.

---

## 9. Commit messages
Format: `#<issue> <imperative summary>`, under ~72 chars, present tense.
```
#1 scaffold Next.js app with Tailwind and Drizzle
#6 redact phone numbers before LLM call
#13 add refund_short rule with tolerance test
```
- Non-issue work: `chore:`, `docs:`, `fix:` prefix (e.g. `docs: update README setup`).
- `Closes #N` in the body of the final commit for an issue.
- Agent commits add a trailer with the agent ID: `Agent: chelsea-claude-1`.

---

## 10. Shared files: coordinate before editing

| File / area | Rule |
|---|---|
| `src/db/schema/*` | One file per domain, set up in #1 from `deepdive_S14.md` §3. Changing a column others use: post `INTERFACE` first. |
| Shared types / Zod schemas | One canonical location; import, never copy. Changes: post `INTERFACE` on dependent issues. |
| `package.json` / lockfile | Announce on the Coordination issue before adding a dependency. Lockfile conflict: take `main`'s version, re-run `npm install`. |
| Styles, tokens, `src/components/**` (views) | **Alex (section 0).** Open a `ui-design` issue to request changes. |
| `src/app/**/page.tsx`, `middleware.ts`, `src/hooks/**` | **Kenan (section 0).** Open a `ui-wiring` issue to request data/routing changes. |
| `.env.example` | Append only; placeholder values only. (`LLM_API_KEY` was replaced by `ANTHROPIC_API_KEY` + `LLM_MODEL` in #7.) |
| `src/app/api/auth/**`, `src/lib/auth/**`, DB client/init | **Kenan** (written by Chelsea, now inactive). Security-sensitive: keep her tests passing; delete-all uses `resolveSessionUser` + per-user revoke (#84). |
| `src/app/api/claims/**`, `src/lib/claims/**` | #32 (claim drafts backend). |
| `src/app/api/eval/**`, `src/lib/eval/**` | #21 (eval backend). |
| Other `src/app/api/**`, `src/lib/store/**`, `src/lib/api/**`, `src/lib/demo/**`, `src/lib/pipeline/run.ts` | #4 / #31 (demo pipeline, store, JSON API, typed client). |
| `AGENTS.md`, `COORDINATION.md` | Change only with Kenan's OK; announce on the Coordination issue. |

Frontend builds against **mocked API responses** that match the Zod contracts, so UI and backend can proceed in parallel.
When the JSON API lands (#4), the UI swaps `@/lib/mock/data` for `@/lib/api/client` (`docs/api.md`).

---

## 11. Work order (waves)
Critical path from `deepdive_S14.md` §8. Pick from the earliest wave with available issues.

| Wave | Issues | Notes |
|---|---|---|
| 0 | #1 scaffold · #2 GCP/OAuth · #9 design system | #1 and #9 = **Alex**. #2 is a human task (GCP console) |
| 1 | #3 OAuth · #4 demo mode · #5 seed inbox · #26 system states (after #9) | after #1 lands (#5 seed generator can start as a standalone script). #26 = **Alex** |
| 2 | #6 → #7 → #8 ingestion chain · #10, #11, #24 connect screen, #25 sync progress UI (mocked API) | one owner for the whole ingestion chain. UI issues = **Alex** |
| 3 | #13 → #14, #15 rules · #12 trust page | #12 UI = **Alex**; backend = **#31** |
| 4 | #16 hero · #17 claim drafts · #21 eval · #22 e2e · #23 README | #16 = **Alex**. #17 UI = **Alex**; backend = **#32**. #21: backend = team, `/eval` page = **Alex** |
| cut-first | #18 L3 rewards · #19, #20 stretch | only if ahead (plan.md §3) |

**Gate (h10):** real Gmail or demo inbox → ≥1 ledger row + 1 `refund_overdue` finding end-to-end. If red, ship demo-mode only.
Run at most ~3–4 backend agents at once; more creates conflicts faster than they save time.

---

## 12. AI agent usage log (for the README / Devpost "how we built it")
Devin is **not used** (dropped 2026-10-17). Agent work is documented through GitHub itself: every agent posts its
agent ID in `CLAIMED`/`DONE` comments and an `Agent: <id>` commit trailer, so the log can be rebuilt any time:
```powershell
git log --format="%h %an | %s | %(trailers:key=Agent,valueonly,separator=%x2C)"
gh search issues "DONE by" --repo VeneratedApotheosis/Paper-Trail --state closed
```

---

## 13. `gh` cheat sheet
```powershell
gh issue view 6 --comments                          # read issue + claims/progress
gh issue edit 6 --add-assignee @me                  # claim, step 1
gh issue comment 6 --body-file claim.md             # claim, step 2 (also progress/handoff)
gh issue edit 6 --remove-assignee @me               # unclaim
gh issue edit 6 --add-label blocked                 # mark blocked
gh issue close 6 --comment "Closed, see DONE above" # finish
gh issue create --title "..." --body-file body.md --label backend   # new issue
```
Windows tips:
- Avoid long inline `--body` strings with quotes. Write to a file and use `--body-file`.
- **Write comment files as UTF-8 without a BOM.** Windows PowerShell 5.1 `Set-Content -Encoding utf8` adds a BOM,
  which hides the `CLAIMED` / `DONE` prefix from anyone searching or parsing comments. Use:
  `[IO.File]::WriteAllText("claim.md", $text, (New-Object Text.UTF8Encoding $false))`
  (PowerShell 7: `Set-Content -Encoding utf8NoBOM`).
- `--jq` expressions containing `"` or spaces break in PowerShell 5.1. Pipe `--json` output to `ConvertFrom-Json`
  instead, and add `| % { $_ }` to unwrap the array.
- Never set an issue body from a variable holding `gh ... --jq .body` output: PowerShell splits it into lines and
  re-joins them with spaces. Edit the body from a file.

---

## 14. Rhythm (hackathon)
- **Every ~4 hours:** 5-minute human sync. Check the board (section 3) together and re-pick from the waves table.
- **Before sleeping / handing off:** push everything; post `PROGRESS` or `UNCLAIMED` on every issue you hold.
- **Feature freeze (h24):** only bug fixes, eval, demo polish, and README after this point.
