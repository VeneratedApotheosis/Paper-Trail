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
| **Kenan** | `VeneratedApotheosis` | Repo owner, final say on scope. Merges Devin PRs |
| **Alex** | `ptatoo` | **All frontend/design** (hands off, see below) + issue #1 scaffold |
| **Ethan Lowe** | `ethanwlowe7-cmyk` | Backend/ingestion work, claimed per issue |
| **Chelsea** | `chelsearwang` | Backend/ingestion work, claimed per issue |

### Alex owns frontend/design: everyone else stays out
**Alex (`ptatoo`) and the agents Alex runs own all frontend and design work. Nobody else edits it.**

| Alex owns (hands off) | Everyone else |
|---|---|
| Issues **#9, #10, #11, #16, #24, #25, #26** | Ingestion, backend, rules, infra, QA issues |
| UI parts of **#12** (trust page) and **#17** (claim drafts) | Backend parts of #12 and #17 (`src/app/api/**`, `src/lib/audit/`, `src/lib/claims/`) |
| Issue **#1** (scaffold), claimed by Alex | Wait for #1 to land before starting app code |
| `src/app/**/page.tsx`, `src/app/**/layout.tsx`, `src/components/**` | `src/app/api/**`, `src/lib/**`, `src/db/**` |
| `src/styles/**`, `tailwind.config.*`, `public/**`, Paper files | `seed/**`, `scripts/**`, `e2e/**` |

Rules for everyone who isn't Alex or one of his agents:
1. **Never edit, refactor, reformat, or "fix" files Alex owns**, even if a build error points there. Tell Alex instead.
2. **Never claim, relabel, reassign, or close Alex's issues.** Commenting a question or contract change is fine.
3. The contract between UI and backend is the **shared Zod schemas/types and API routes**. If you change one the UI
   uses, comment the exact change on Alex's issue and tag `@ptatoo`. Don't update his code to match.
4. Need a UI change? Open a new issue labeled `frontend` and leave it for Alex.

---

## 1. Identify yourself (every agent, every session)
Several agents can post from the **same GitHub account** (e.g. all of Alex's agents post as `ptatoo`).
The assignee shows the **human**; the **agent ID** in comments shows which agent.

**Agent ID format:** `<person>-<tool>-<n>`, e.g. `kenan-pi-1`, `alex-pi-ui-2`, `chelsea-claude-1`, `ethan-cursor-1`, `kenan-devin-1`.
- Pick it at session start. If your operator didn't give you one, use `<person>-<tool>-1`; if that ID already has an
  open claim that isn't yours, increment `n`.
- Put the agent ID in **every** comment you post (claims, progress, handoffs).
- Humans working by hand use just their name (e.g. `chelsea`).

---

## 2. Issue states: how to tell who is doing what

| State | How it looks on GitHub | Meaning |
|---|---|---|
| **Available** | open, **no assignee**, no `blocked` label | Anyone (except on Alex's issues) may claim it |
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
gh issue list --assignee ethanwlowe7-cmyk
gh issue list --assignee chelsearwang

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
   - **unassigned** and no active `CLAIMED` comment
   - **not Alex's** (section 0), unless you are Alex or Alex's agent
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
- Splitting an issue (e.g. frontend vs backend half): say exactly which half in the claim (`Scope: backend only`).

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

**Stale claims:** a claim with no comment or commit for **4+ hours** may be taken over. Comment on the issue tagging the
owner, wait ~15 minutes, then claim with `CLAIMED (takeover) by ...`. Never take over Alex's issues; ask Alex.

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
- Devin session: <link>   (only if Devin did the work)
```
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
cd ../pt-issue-6
# ...work + commit...
git pull --rebase origin main
git push origin HEAD:main                              # lands on shared main
cd ..; git worktree remove pt-issue-6; git branch -D wip/6   # when the issue is done
```
The `wip/*` branch is local only. Never push it as its own branch.

### Merge conflicts
- Rebase conflict: resolve, `git add`, `git rebase --continue`. If unsure, `git rebase --abort` and ask the file's owner.
- Agents: **don't resolve conflicts in files outside your issue by guessing.** Stop and comment on the issue.
- Conflict in an Alex-owned file: keep Alex's version and tell him.

### Devin and short-lived branches
**Devin** works on its own branch `devin/<N>-<slug>` and opens a PR titled `#<N> <summary>` with `Closes #<N>` and the
session link. Kenan merges Devin PRs quickly; they double as sponsor evidence.
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
| UI files, `tailwind.config`, design tokens | **Alex owns these (section 0).** Open a `frontend` issue to request changes. |
| `.env.example` | Append only; placeholder values only. |
| `AGENTS.md`, `COORDINATION.md` | Change only with Kenan's OK; announce on the Coordination issue. |

Frontend builds against **mocked API responses** that match the Zod contracts, so UI and backend can proceed in parallel.

---

## 11. Work order (waves)
Critical path from `deepdive_S14.md` §8. Pick from the earliest wave with available issues.

| Wave | Issues | Notes |
|---|---|---|
| 0 | #1 scaffold · #2 GCP/OAuth · #9 design system | #1 and #9 = **Alex**. #2 is a human task (GCP console) |
| 1 | #3 OAuth · #4 demo mode · #5 seed inbox | after #1 lands (#5 seed generator can start as a standalone script) |
| 2 | #6 → #7 → #8 ingestion chain · #10, #11, #24, #25, #26 UI | one owner for the ingestion chain. UI issues = **Alex** |
| 3 | #13 → #14, #15 rules · #12 trust page | #12: backend = team, UI = **Alex** |
| 4 | #16 hero · #17 claim drafts · #21 eval · #22 e2e · #23 README | #16 = **Alex**. #17: backend = team, UI = **Alex** |
| cut-first | #18 L3 rewards · #19, #20 stretch | only if ahead (plan.md §3) |

**Gate (h10):** real Gmail or demo inbox → ≥1 ledger row + 1 `refund_overdue` finding end-to-end. If red, ship demo-mode only.
Run at most ~3–4 backend agents at once; more creates conflicts faster than they save time.

---

## 12. Devin usage log (Cognition prize requirement)
Every Devin session: put the session link in the `DONE` comment and the PR body. The log is built from GitHub:
```powershell
gh pr list --state all --search "devin in:title,body"
gh search issues "Devin session" --repo VeneratedApotheosis/Paper-Trail
```
This feeds the README "Built with Devin" section and the Devpost form.

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
Windows tip: avoid long inline `--body` strings with quotes. Write to a file and use `--body-file`.

---

## 14. Rhythm (hackathon)
- **Every ~4 hours:** 5-minute human sync. Check the board (section 3) together and re-pick from the waves table.
- **Before sleeping / handing off:** push everything; post `PROGRESS` or `UNCLAIMED` on every issue you hold.
- **Feature freeze (h24):** only bug fixes, eval, demo polish, and README after this point.
