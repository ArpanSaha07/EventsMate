# Agent matching and standby conditions (F5, TODO item 9)

Updated: 2026-11-11 · Decisions: D9, D50, D54-D56 · Status: **built; gate met with the real model and the database, not yet run end to end with PayPal**

The model proposes who gets which released seats; code decides. It builds on rule-based
settlement (`features/settlement.md`), which stays as the fallback and does all the money steps.

## Scope

In scope:

- **Allocation by the model.** When first-come would leave a waiting request unfilled, the
  model proposes an allocation that fills more requests completely (D9).
- **Validation by code.** Every proposed pair is re-checked: real request, real released
  seat, exact quantity (D50), accepted tier, not the fan's own seat, no seat or request used
  twice, same-tier condition, total within the hold. One invalid pair rejects the whole
  proposal.
- **Choosing.** The model's plan is used only if valid and it fills more requests than
  first-come; on a tie first-come wins because it favours the oldest requests (D56).
- **Conditions from the fan's note (D54):** "all my seats in the same ticket type" and
  "I need to know by <time>". Read by the model once when the hold is placed (D55), checked
  by code (each condition must quote the fan's own words; a deadline must be in the future),
  stored in `standby_requests.conditions`. A deadline earlier than the cutoff shortens
  `expires_at`, so the normal expiry sweep ends the request and voids the hold.
- **Reason in the action log.** The agent's one-sentence reason is stored on the `match`
  row of `agent_actions`, prefixed "Agent:".

Out of scope:

- Any other condition (price limits, seat location, accessibility): shown to the fan as
  "not understood, so not enforced".
- The model moving money or calling PayPal. It only returns refs to seats and requests.
- The page that shows the action log (TODO item 7).

## How it works

1. `POST /api/standby/[id]/authorize` places the hold, then `ensureConditionsRead`
   (`lib/standby-conditions.ts`) calls `readConditionsWithModel` and stores what
   `checkConditions` (`lib/conditions.ts`, pure) accepts.
2. `runMatching` → `planEvent` (`lib/settlement.ts`) builds seats and the queue. A request
   whose note is still unread is read now; if that fails it is left waiting, not matched.
3. `planAllocations` (`lib/matching.ts`) gives the first-come baseline.
4. If `worthAskingAgent` (two or more requests, at least one left unfilled), the model gets
   `buildMatchingBrief`: seats as `S1..`, requests as `R1..`, tiers by name, no money, no
   names. `proposeMatchesWithModel` (`lib/ai/standby-agent.ts`) returns its proposal.
5. `validateProposal` then `choosePlan` pick the plan. Amounts are computed by code.
6. `begin_settlement(request, items, reason)` re-checks under row locks (including the
   same-tier condition) and the settlement steps run as before.

The model is asked once per matching run, 20 s limit, no retry. Any error, timeout, invalid
or no-better proposal means first-come is used. Later rounds in the same run (after a failed
capture) use first-come only.

## What people see

- Standby dialog after the hold, and the Standby page: "The agent will enforce: all seats in
  the same ticket type; an answer by Thu, Nov 12, 6:00 PM PST", and "Not understood, so not
  enforced: ..." for the rest. The end time shown is the fan's deadline when it is earlier
  than the cutoff.
- An unread note on an active request: "The agent has not read this note yet. You will not be
  matched until it has."

## Verified (2026-11-11)

- **Gate, better than first-come:** case with 2 General + 1 VIP released and three requests
  (A: 2 seats, General or VIP; B: 1 VIP; C: 2 General). First-come fills 1 request (A takes a
  General and the VIP). The real model (`OPENAI_MODEL` from `.env.local`) proposed A = both
  General, B = VIP; code validated it and chose it: 2 requests filled.
- **Gate, invalid proposal rejected:** 10 unit tests feed invalid proposals (unaccepted tier,
  partial fill, seat used twice, unknown seat or request, request twice, own seat, above the
  hold, mixed tiers for a same-tier fan, malformed output); each is rejected and first-come
  is used.
- **Conditions:** the real model read "Only if both seats are in the same tier. I need to
  know by Thursday 6 pm. Aisle seats please!" as same tier, Thursday 18:00 in the event's
  timezone, and "Aisle seats please!" unsupported.
- **Database:** the new `begin_settlement` was run inside a rolled-back transaction: the
  agent's reason is stored on the match row, and mixed tiers for a same-tier request raise
  `mixed_tiers`. Nothing was left behind.
- A matching run with nobody waiting still works through the API; the Standby page renders
  with no console errors.
- 131 unit tests pass (29 new in `tests/agent-matching.test.ts`, `tests/conditions.test.ts`).

## Lackings and bugs

- **Not run end to end with PayPal.** No request was waiting in the database, and placing
  holds needs a person to approve them in the sandbox. Still to exercise live: a note read at
  the hold and shown in the dialog, a decide-by deadline expiring a request, and an
  agent-chosen allocation going through capture, refund and transfer.
- The model's plan is accepted when it fills more requests, but code does not check that it
  favoured the oldest requests among equally good plans.
- A request whose note cannot be read (model down) is not matched at all until a later run
  reads it.
- Notes on requests placed before this feature are read at the next matching run, not shown
  beforehand.
- The fan sees what was understood only after approving the hold; they can cancel, but cannot
  edit the note.
- `choosePlan`'s explanation (why first-come was used) is only in the server log.
- The matching brief sends the first 8 characters of fan and holder ids to the model so it
  can avoid giving a fan their own seat.
