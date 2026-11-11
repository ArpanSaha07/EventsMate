---
name: paypal-money
description: Rules for any EventsMate code that touches PayPal, prices, holds, captures, refunds, ticket issuance or transfer. Load before writing or reviewing checkout, standby, settlement, refund or webhook code.
---

## Never

- Never use live credentials or endpoints. `PAYPAL_ENV=sandbox` only.
- Never accept an amount, price or currency from the browser or from a model.
- Never show or store success without a verified PayPal response (`COMPLETED` capture,
  `CREATED`/`COMPLETED` authorization as documented, `COMPLETED` refund).
- Never refund a holder before the fan's capture has completed.
- Never issue or transfer a ticket outside a Postgres RPC transaction.
- Never let a model call PayPal. Models propose; confirmed server routes execute.

## Always

- Integer cents everywhere; convert only in `src/lib/money.ts`.
- Send `PayPal-Request-Id` derived from our own row id on every mutating call.
- Make every route idempotent: read current state first, return the existing result on repeat.
- Persist the PayPal id before returning it to the browser.
- After any PayPal call or webhook, re-fetch the resource and trust that, not the event.
- Verify webhook signatures; store the raw event with a unique PayPal event id before processing.
- If PayPal succeeded but our write failed, mark the row for reconciliation and say so in the
  UI. Do not show success.
- Write an `agent_actions` row for every money movement, with the PayPal reference.

## Flows

| Action | Call |
|---|---|
| Buy | Orders v2 create `intent=CAPTURE` → capture |
| Standby hold | Orders v2 create `intent=AUTHORIZE` → authorize after approval |
| Match | Payments v2 capture authorization (`final_capture=true`, amount ≤ authorized) |
| Refund holder | Payments v2 refund the holder's original capture (partial amount) |
| Cancel / expire | Payments v2 void authorization |
| Extend hold | Payments v2 reauthorize (after 3-day honor period, within 29 days) |

Check method signatures against the installed `@paypal/paypal-server-sdk` version or the
current REST reference before writing calls. Do not guess from memory.

## Tests required for any change here

Success; buyer cancels; repeated request (no double charge, no duplicate ticket); tampered
amount rejected; capture failure leaves the holder unrefunded and the ticket released.
