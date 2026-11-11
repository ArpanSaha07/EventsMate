---
name: commit-msg
description: Write a git commit message for EventsMate. Use when the user asks to commit or for a commit message.
---

Commit only when the user asks. Never commit `.env*` files.

Format:

```
<type>(<area>): <what changed, imperative, under 70 characters>

<why, and anything a reviewer must know: 1-3 short lines, optional>
```

- **type:** feat, fix, refactor, test, docs, chore
- **area:** events, checkout, standby, release, settlement, policy, agent, organiser, webhooks, db, ui, docs
- One logical change per commit. Mention the TODO item number when it completes one.
- End with the attribution lines the session provides.
