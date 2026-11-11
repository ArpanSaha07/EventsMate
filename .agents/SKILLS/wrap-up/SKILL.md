---
name: wrap-up
description: End-of-unit checklist for Standy. Verifies the work, then updates the docs, rules, decisions, STATUS and spec it touched, and hands back to Arpan with a commit message ready. Run when a feature or fix is finished, before the commit.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node scripts/*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git rev-parse:*), Bash(ls:*)
---

# Wrapping up a unit of work

Run these in order. The point is not tidiness: everything below is a thing the
*next* session pays for if it is skipped, and each step exists because skipping
it has already cost something.

Do not skip a step because it looks like it does not apply — say so instead. If
a step turns out to be genuinely empty, that is a one-line report, not silence.

## 1. Verify

```bash
node scripts/verify.mjs          # --full if the backend changed
```

Green is the precondition for everything below. A red suite means the unit is
not finished, and none of the recording steps should run yet.

## 2. Docs and rules the code moved under

```bash
git diff --name-only origin/develop...
```

Compare that against `scripts/docs-map.json`. For every mapped doc or rule whose
code changed, update it — or, if the change genuinely does not affect it,
re-stamp it and say why in your report.

**The stamp is a sha, never prose.** `git rev-parse --short HEAD`, taken at the
moment you re-read the code against the doc. For three weeks every mapped doc
carried something like *the uncommitted working tree*, which the checker could
not parse and therefore silently reported nothing about.


## 3. The queue

Move the finished item out of [`todo.md`](../../TODO/todo.md) into
[`tasks-completed.md`](../../TODO/tasks-completed.md), **under its original topic
heading**, keeping the date and the write-up. The queue only stays useful if
finished work leaves it. Add anything new the work uncovered.

## 4. STATUS.md

[`STATUS.md`](../../STATUS.md) is what the next session orients from, so it is
the one file that must be right:

- a *Recently shipped* line, newest first, capped at ten
- *Now* re-ordered — what is next, given this landed
- a *Watch out* line if the work armed or disarmed a trap, carrying the bug id
  and the rule holding it
- the `Code as of:` stamp moved to `git rev-parse --short HEAD`

## 5. Bugs and traps

Fixed a bug → move it to [`fixed_bugs.md`](../../bugs/fixed_bugs.md) with the
reasoning, and refresh the moved-list line at the top of
[`bugs.md`](../../bugs/bugs.md). Found one → open it in `bugs.md`.

## 6. Decisions

Chose between real alternatives? Write a **Proposed** ADR in
[`docs/decisions/`](../../docs/decisions/README.md) and add its row to the index.
Only Arpan flips a Status to Accepted — proposing is yours, deciding is not.

## 7. The spec

Mark the `.claude/specs/` file `Status: shipped`. If the work drifted from what
the spec agreed, say so in your report — that is a fact Arpan needs, not a
failure to hide.

## 8. Let the checkers confirm it

```bash
node scripts/check-docs.mjs
node scripts/check-links.mjs --strict
```

Both clean. `check-docs` naming a doc you did not touch means step 2 is not
finished; a dead link means something above points at a file that moved.

## 9. The commit message

Run `/commit-msg`. Never commit, stage or push — that is Arpan's.

## 10. Report

Say plainly: what landed, what to review first, what is still open, and what
only Arpan can decide. Name anything you skipped and why. A wrap-up that
overstates what is finished is worse than none.