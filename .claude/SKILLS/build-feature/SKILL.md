---
name: build-feature
description: Build one EventsMate feature end to end. Use whenever starting, continuing or finishing an item from .claude/docs/TODO.md, or when the user says "next feature", "build F3", or similar.
---

Build exactly one TODO item per run.

1. **Pick.** Take the first unchecked item in `.claude/docs/TODO.md`. State its gate.
2. **Read.** The matching section of `product-features.md`, `architecture.md`, and `decisions.md`.
3. **Ask.** List every choice the item needs that is not under "Decided". Ask them all in one
   AskUserQuestion round (recommendation first). Record answers in `decisions.md`. Do not start
   code with an open choice.
4. **Slice vertically.** Database first, then server route, then UI. Server computes every
   amount; the browser never sends a price.
5. **Money or tickets involved?** Load the `paypal-money` skill before writing code.
6. **Validate.** Zod at every route boundary. Typed errors the UI can show. No fake success paths.
7. **Test.** Unit-test pure logic (amounts, refund rules, allocation validation, state
   transitions) with Vitest.
8. **Verify.** `npm run typecheck`, `npm run lint`, `npm test`, then exercise the gate in the
   browser against the sandbox. Report what was and was not verified.
9. **Record.** Tick the item in `TODO.md`, update `STATUS.md`, append one line to
   `task-completed.md`, log any defect in `bugs.md`.
10. **Stop** and report. Do not roll into the next item unless the user says so.

Anything discovered that is outside `product-features.md` goes to `future.md`, not into code.
