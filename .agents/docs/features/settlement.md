# Settlement and rule-based matching (F5)

Updated: 2026-11-11 · Decisions: D9, D10, D28, D35, D36, D50-D53 · Status: **working, gate met in the sandbox**

The agent resells a released seat to a fan on standby: it captures the fan's PayPal hold,
refunds the holder under the event's policy, then transfers the ticket.

## Scope

In scope:

- Rule-based, first-come matching: the oldest standby request that can be filled completely
  gets the seats released earliest. All or nothing (D50).
- Matching runs right after a release and right after a standby hold is placed (D51), so
  either order works. No timer.
- One PayPal capture per standby request for the tiers' face prices; the rest of the hold is
  released (`final_capture`).
- Partial refund of the holder's original capture, computed at resale from the rule copied at
  release (D35, D36).
- Transfer: the holder's ticket becomes `transferred` and a new `valid` ticket is issued to
  the fan, backed by the fan's capture (so the fan can release it later).
- A failed capture closes that request, refunds nobody, leaves the seat released and tries
  the next request.
- An `agent_actions` row for the match, the capture, the refund and the transfer, each with
  its PayPal reference. (The page that shows them is F9, TODO item 7.)

Out of scope (later items or `future.md`):

- Agent (model) allocation and free-text conditions: TODO item 9.
- The action log page: item 7. Webhook reconciliation: item 12.
- Reauthorizing holds past PayPal's 3-day honor period (D53: capture directly).
- Partial fills (D50).

## How it works

1. `POST /api/tickets/release` and `POST /api/standby/[id]/authorize` call
   `runMatchingQuietly(eventId)` (`lib/settlement.ts`) after their own work succeeded. A
   matching error never fails the release or the hold.
2. `runMatching` sweeps the cutoff (`return_unmatched_tickets`, `expireDueStandbyRequests`),
   finishes any request still `matched`, then plans with `planAllocations`
   (`lib/matching.ts`, pure) from released seats and authorized requests.
3. Per allocation, `begin_settlement` (RPC) re-checks everything under row locks (request
   authorized, ticket released, tier accepted, not the fan's own seat, before the cutoff,
   total within the hold, refund within the price paid), inserts one `settlements` row per
   ticket and sets the request to `matched`.
4. `settleRequest` (`lib/settlement-flow.ts`) drives the steps from stored state:
   capture → `record_settlement_capture`; refund → `complete_settlement`, which records the
   refund, transfers the ticket and settles the request in one transaction.
5. Idempotency: the capture uses `PayPal-Request-Id` `capture-hold-<request id>`, the refund
   `refund-resale-<settlement id>`. A unique index allows one live settlement per ticket.

## Failure handling

| Case | Result |
|---|---|
| PayPal refuses the capture (4xx, DECLINED) | Settlement `capture_failed`, request `failed`, hold voided (best effort), seat stays released, next request tried |
| No definite answer on the capture (timeout, 5xx, PENDING, wrong amount) | Nothing recorded; request stays `matched`; retried with the same key on the next run |
| Refund fails after capture (D52) | Settlement `refund_failed`; ticket NOT transferred; holder sees "Being resold", fan sees "finishing payment"; retried on the next run |
| Refund done but the transfer write fails | Settlement `refunded` with the refund id kept; the retry transfers without refunding again |

## What people see (D47)

- Holder, My tickets: "Being resold" while in progress; "Resold" with the refund amount, the
  rule and PayPal's refund reference. Release toast says so when it sells immediately.
- Fan, Standby: "Seat found" with the amount charged and the capture reference; "Failed, not
  charged" after a refused capture. My tickets marks the ticket "From standby". The standby
  dialog says "You got a seat" when a seat was already waiting.

## Verified (2026-11-11, real sandbox and database)

- Gate: Liam's hold was voided at PayPal outside the app, then matching was triggered for
  Maya's released Hack Night seat. Liam: capture refused (`AUTHORIZATION_VOIDED`), nobody
  refunded, seat still released. Next request (Noah): capture `COMPLETED` $15.00, Maya's
  refund `COMPLETED` $14.00 (full refund minus $1 fee), ticket transferred, six action rows.
- Repeat calls create nothing new; taking back a resold ticket is refused.
- My tickets and Standby pages checked in the browser for Maya, Noah and Liam.
- 22 unit tests (`tests/matching.test.ts`, `tests/settlement-flow.test.ts`).

## Lackings and bugs

- Not exercised live: a multi-seat request, a refund failure, an unconfirmed capture, and the
  "seat already waiting" path through the standby dialog (covered by unit tests only).
- A request stuck in `matched` or `refund_failed` is retried only when someone next releases
  or joins standby for that event. There is no timer (D51) and no webhook yet.
- Matching runs inside the release / authorize request, so those calls take several seconds
  when a match settles (about 12 s for a failed capture plus a full settlement).
- The capture log line always says "The rest of the hold is released", also when the whole
  hold was captured.
- After a refused capture the fan's request is closed; they must go on standby again.
- A wrong-amount capture is only logged to the server console, not flagged in the UI.
