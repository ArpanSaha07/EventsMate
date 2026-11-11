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

Run `bash scripts/sync-agents.sh` from the repo root. It asks the Codex agent (headless
`codex exec`, write access to `.agents/` only) to make `.agents/` match `.claude/`, then
verifies the result with a diff. Report its outcome. If it fails, say so and show its output;
do not edit `.agents/` by hand. Tell the user that the synced `.agents/` files belong in the
same commit as the `.claude/` docs they mirror. The sync does not commit either.
