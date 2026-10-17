# COORDINATION.md — Git, Commits & Team/Agent Coordination

How humans and AI agents work together on PaperTrail without stepping on each other.
Model: **everyone works on `main`** (trunk-based). GitHub Issues is the task board. No long-lived branches.

---

## 1. The board: GitHub Issues
Every unit of work is an issue (#1–#23 created from `ISSUE_PLAN.md`). New work → new issue (use the **Task** template).

### Labels
| Label | Meaning |
|---|---|
| `L1-core` / `L2-refunds` / `L3-rewards` / `stretch` | Build layer — finish L1 before L2; L3 is cut first |
| `ingestion` / `backend` / `frontend` / `design` / `infra` / `qa` | Work area |
| `blocked` | Waiting on another issue or an external dependency |
| `bug` | Something is broken |

### Claiming an issue
1. Check it's **unblocked**: every issue listed under "Dependencies" is closed.
2. Check nobody else claimed it (no assignee, no "claimed" comment).
3. Assign the human responsible: `gh issue edit <N> --add-assignee @me`
4. Comment the claim (agents: say which agent):
   ```
   Claimed by <name / agent>. Plan: <1-3 lines>. Files I expect to touch: <paths>.
   ```
One issue = one owner at a time. Want to help on a claimed issue? Ask in a comment first.

### While working
- **Blocked?** Add `blocked`, comment what you're waiting on (`blocked by #8`), move to another issue.
- **Scope creep?** Don't expand the issue — file a new issue and link it.
- **Spec unclear?** Comment the question on the issue and tag the owner; don't guess on product rules.

### Finishing — handoff comment (required)
```
Done.
- What changed: <summary>
- Files: <main paths>
- Interfaces changed: <types/APIs/schema others depend on, or "none">
- How to verify: <command or steps>
- Follow-ups: #<new issue> (or "none")
- Devin session: <link>   ← only if Devin did the work
```
Close the issue only when every acceptance criterion is checked (or `Closes #N` in the final commit).

---

## 2. Git workflow (shared `main`)

### Golden rules
1. **One working folder per writer.** Each human and each local agent uses its own clone or `git worktree`.
   Two agents in the same folder will overwrite each other — never do this.
2. **Pull before you start, and before you push:** `git pull --rebase`
3. **Commit small, push often** — every 30–60 min of work, not one giant push.
4. **Never push a broken build.** `npm run lint && npm run typecheck && npm test` must pass first.
5. **Never force-push `main`.** Never rewrite pushed history.

### Typical loop
```powershell
git pull --rebase
# ...make a small, working change...
npm run lint; npm run typecheck; npm test
git add <specific files>          # not `git add .` blindly — check for secrets
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
The `wip/*` branch is local only — never push it as its own branch.

### Merge conflicts
- Rebase conflict: resolve, `git add`, `git rebase --continue`. If unsure, `git rebase --abort` and ask the file's owner.
- Agents: **don't resolve conflicts in files outside your issue by guessing** — stop and comment on the issue.

### When to use a short-lived branch anyway
Only for risky changes (schema rewrite, big refactor, dependency upgrade): branch → finish within the hour → merge to `main`.
**Devin** usually opens PRs from its own branch — that's fine; merge them quickly (they double as sponsor evidence).

---

## 3. Commit messages
Format: `#<issue> <imperative summary>` — under ~72 chars, present tense.
```
#1 scaffold Next.js app with Tailwind and Drizzle
#6 redact phone numbers before LLM call
#13 add refund_short rule with tolerance test
#16 fix hero card empty state
```
- Optional prefix for non-issue work: `chore:`, `docs:`, `fix:` (e.g. `docs: update README setup`).
- Use `Closes #N` in the commit body of the final commit for an issue.
- AI-generated commits: add a trailer so we can document agent usage, e.g. `Co-authored-by: Devin <...>` or
  `Agent: claude-code`.

---

## 4. Avoiding conflicts on shared files
These files are touched by many issues. Coordinate before editing:

| File / area | Rule |
|---|---|
| `src/db/schema/*` | One file per domain. Defined up front in #1 from `deepdive_S14.md` §3. Changing a column others use → comment on the issue first. |
| Shared types / Zod schemas | One canonical location; import, never copy. Interface changes go in the handoff comment. |
| `package.json` / lockfile | Announce new dependencies in team chat before adding. Lockfile conflict → take `main`'s version, re-run `npm install`. |
| `tailwind.config` / design tokens | Owned by the design issue (#9). Others request changes. |
| `.env.example` | Append only; placeholder values only. |

Frontend can start before the backend is done by building against **mocked API responses** that match the Zod contracts.

---

## 5. Work order (waves)
Critical path from `deepdive_S14.md` §8. Pick from the earliest wave with unblocked issues.

| Wave | Issues | Notes |
|---|---|---|
| 0 | #1 scaffold · #2 GCP/OAuth · #9 design system | #2 and #9 are **human** tasks (GCP console, Paper) |
| 1 | #3 OAuth · #4 demo mode · #5 seed inbox | parallel after #1 |
| 2 | #6 → #7 → #8 ingestion chain · #10, #11 UI (mocked API) | one owner for the whole ingestion chain |
| 3 | #13 → #14, #15 rules · #12 trust page | |
| 4 | #16 hero · #17 claim drafts · #21 eval · #22 e2e · #23 README | |
| cut-first | #18 L3 rewards · #19, #20 stretch | only if ahead (plan.md §3) |

**Gate (h10):** real Gmail or demo inbox → ≥1 ledger row + 1 `refund_overdue` finding end-to-end. If red, ship demo-mode only.

Run at most ~3–4 agents at once; more creates conflicts faster than they save time.

---

## 6. Devin usage log (Cognition prize requirement)
For every Devin session, record it in the issue's handoff comment **and** in the table below (append-only):

| Date | Issue | What Devin did | Session link | Outcome (merged / partial / discarded) |
|---|---|---|---|---|
| | | | | |

This feeds the README "Built with Devin" section and the Devpost form.

---

## 7. Useful `gh` commands
```powershell
gh issue list --label L1-core --state open          # what's left in Layer 1
gh issue list --assignee @me                        # my work
gh issue view 6                                     # read an issue
gh issue edit 6 --add-assignee @me                  # claim
gh issue comment 6 --body-file handoff.md           # comment (use files on Windows for long text)
gh issue edit 8 --add-label blocked                 # mark blocked
gh issue close 6 --comment "Done, see handoff above"
```
Windows tip: avoid long inline `--body` strings with quotes — write to a file and use `--body-file`.

---

## 8. Daily rhythm (hackathon)
- **Every ~4 hours:** 5-minute sync — what's done, what's blocked, re-pick from the wave table.
- **Before sleeping / handing off:** push everything, leave a handoff comment on any in-progress issue.
- **Feature freeze (h24):** only bug fixes, eval, demo polish, and README after this point.
