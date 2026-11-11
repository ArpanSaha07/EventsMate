# EventsMate

An event ticketing platform where an AI agent resells released seats at sold-out events:
fans go on standby with a PayPal hold, holders release seats they can't use, and the agent
captures the hold, refunds the holder and transfers the ticket.

Built for the PayPal AI Hackathon. Deadline: **Nov 12, 2026, 12:00 pm Pacific**.
The app lives in `frontend/` (Next.js; there is no separate backend).

## Read before working

| Doc | When |
|---|---|
| `.claude/docs/product-features.md` | What the product does, per role |
| `.claude/docs/decisions.md` | Before any product or technical choice |
| `.claude/docs/architecture.md` | Data model, state machines, PayPal and AI flows |
| `.claude/docs/TODO.md` / `STATUS.md` | What to build next / where things stand |
| `.claude/docs/future.md` | Deferred ideas. Do not build these |
| `frontend/AGENTS.md` | Next.js 16 differs from training data; read its docs first |

## Rules

1. **Never assume a decision.** If `decisions.md` does not settle it, ask the user with
   AskUserQuestion, then record the answer there. This covers product, UX and technical choices.
2. **One feature at a time**, in `TODO.md` order. Follow the `build-feature` skill.
3. **Money rules are absolute.** Follow the `paypal-money` skill for anything touching
   PayPal, prices, refunds or tickets. Sandbox only. No simulated payment success, ever.
4. **The model proposes; code decides.** Every AI output is schema-validated and re-checked by
   deterministic code before it changes state or moves money.
5. **Scope discipline.** Anything outside `product-features.md` goes to `future.md`, not into code.
6. **Keep docs true.** After each feature, update `STATUS.md`, `TODO.md` and `task-completed.md`;
   log defects in `bugs.md`.
7. Secrets live only in `frontend/.env.local`. Never read them aloud, log them or commit them.

## Commands (run in `frontend/`)

`npm run dev` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run build`

A feature is done only when typecheck, lint and tests pass and the flow was exercised in the
browser against the real sandbox.
