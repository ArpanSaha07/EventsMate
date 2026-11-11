# Product features

## The problem

When an event sells out, seats still go empty and fans are pushed to risky resale.

- Paid events have a median no-show rate of about 17% (Pheedloop, 1,070+ events).
- Existing waitlists are manual: the organiser releases a ticket, the fan gets an email and
  must come back and buy within a claim window (Eventbrite).
- About 26% of people buying tickets from unofficial sources receive fakes (Surfshark, 2026).

Figures come from vendors and surveys; cite them as indicative.

## What EventsMate does

EventsMate is a ticketing platform for independent organisers. Its agent turns a seat someone
can't use into a seat someone else gets, with the money moved safely through PayPal:

1. A **fan** goes on standby for a sold-out event and approves a PayPal hold (authorized, not charged).
2. A **ticket holder** says they can't make it and releases their seat.
3. The **agent** matches released seats to standby requests, captures the fan's hold, then
   refunds the holder under the organiser's policy, and transfers the ticket.
4. The **organiser** sees seats recovered and every action the agent took.

The holder is refunded only from a completed resale, so the organiser never loses money.
All events are hosted and sold on EventsMate; it does not touch third-party ticketing sites.

## Roles

Sign-in is a demo persona switcher: seeded fans, holders and an organiser, no passwords.

## Features in scope

### F1. Events and tiers
- Browse published events in San Francisco, priced in USD.
- Each event has ticket tiers (for example General, VIP) with their own price and capacity.
- Event page shows availability per tier, the refund policy in plain words, and standby demand.

### F2. Buy a ticket
- Pick a tier and quantity, review the exact total, pay with PayPal (immediate capture).
- Tickets are issued only after the server verifies a completed capture.
- "My tickets" lists tickets with their status.

### F3. Go on standby (PayPal hold)
- On a sold-out tier, a fan requests seats for that one event: quantity, accepted tiers,
  maximum price per seat, and optional conditions in free text
  ("only if both seats are in the same tier", "I need to know by Thursday 6 pm").
- The fan approves one PayPal authorization covering the worst case (quantity × highest
  accepted price). Nothing is charged until a match.
- The fan can cancel any time before a match; the hold is voided.
- Requests expire at a stated time; expired holds are voided.

### F4. Release a seat
- A holder releases one or more of their tickets.
- Before confirming, they see exactly what they would get back and why, from the policy reader (F6).
- The ticket stays theirs until it is resold. They can take it back before a match.
- If nothing matches by the cutoff, the ticket returns to them with no refund.

### F5. Agent matching and settlement
- The agent allocates released seats to standby requests to satisfy the most requests
  completely, respecting tier, quantity, price cap and free-text conditions.
- Among equally good allocations, the oldest request wins.
- Deterministic rules validate every proposed allocation before money moves; if the model
  fails, a rule-based first-come allocation is used.
- Settlement order per match: capture the fan's hold, then refund the holder, then transfer
  the ticket. A failed capture moves to the next request and refunds nobody.

### F6. Refund policy reader
- The organiser writes the refund policy in plain language per event.
- The AI converts it to a structured rule the organiser confirms.
- For each release, the holder sees the amount, the rule applied and the policy sentence it came from.

### F7. Agent command bar
- Anyone can type what they want: "I can't make Friday's workshop", "put me on standby for
  two VIP seats, up to $60 each", "cancel my standby".
- The agent resolves the event and tickets with tools, then shows the exact action to confirm.
  It never moves money from a typed sentence alone.

### F8. Organiser dashboard
- Per event: sold, released, on standby, seats recovered, refunds issued, net revenue.
- Grid of tickets, holds, matches and refunds (AG Grid).
- Calendar of events, hold expiries and release cutoffs (Bryntum).

### F9. Action log
- Every agent decision and PayPal call is recorded with a plain-language reason and the
  PayPal reference, visible to the people it affects.

### F10. PayPal webhooks
- Signed PayPal events are verified and reconciled so state stays correct if a browser
  closes mid-payment or an authorization is voided or expires on PayPal's side.

## Not in scope

See `future.md`: organiser-cancels-event refunds, conversational discovery, event creation UI,
numbered seats, real accounts, live payments, third-party ticketing.
