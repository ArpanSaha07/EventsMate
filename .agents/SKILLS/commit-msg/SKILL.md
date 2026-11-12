---
name: commit-msg
description: Write a git commit message for EventsMate (message only, never commits). Use when the user asks for a commit message.
---

**Write the commit message only. Do not run `git add`, `git commit` or `git push`.** The user
stages and commits themselves, on the branch they choose. Print the message in a code block so
it can be copied. If the changes are more than one logical change, give one message per commit
and list which files belong to each. Never include `.env*` files in a suggested commit.

Format:

```
<type>(<area>): <what changed, imperative, under 70 characters>

<why, and anything a reviewer must know: 1-3 short lines, optional>
```

- **type:** feat, fix, refactor, test, docs, chore
- **area:** events, checkout, standby, release, settlement, policy, agent, organiser, webhooks, db, ui, docs
- One logical change per commit. Mention the TODO item number when it completes one.
- No attribution: do not add a `Co-Authored-By` line or any other AI or tool credit, even if
  the session provides one.

## After the commit message

Run `bash scripts/sync-agents.sh` from the repo root, with a Bash timeout of at least 10
minutes. What it does:

- It compares `.claude/` with `.agents/` first. If they already match, it prints "Nothing to
  do" and exits within a second.
- Otherwise it opens a new terminal window where a Codex agent updates a temporary copy of
  `.agents/`. Codex can write only to that copy. The script waits, checks that the copy
  exactly matches `.claude/`, and only then copies it into `.agents/`.
- It mirrors everything in `.claude/` except Claude-only files (`CLAUDE.md`,
  `CLAUDE.local.md`, settings files, `*.local.*`, `worktrees`). Files that exist only in
  `.agents/`, such as `AGENTS.md`, are left alone.

Report the outcome in one line. If it fails, say so and show its error message (it explains
whether the terminal, Codex or the final check failed); do not edit `.agents/` by hand. Tell
the user that the synced `.agents/` files belong in the same commit as the `.claude/` files
they mirror, and list them with the files for that commit. The sync does not commit either.
