# Architecture

Proposed design. Items marked (open Ox) wait on `decisions.md`.

## Shape

One Next.js app in `frontend/`. Route Handlers are the backend. Supabase Postgres is the
system of record, reached only from the server with the service-role key. PayPal sandbox moves
money. OpenAI proposes; server code validates and executes.

```
Browser ── Route Handlers ──┬─ Supabase Postgres (state, RPC transactions)
                            ├─ PayPal sandbox (Orders v2, Payments v2, Webhooks)
                            └─ OpenAI (structured outputs, tool calls)
PayPal ── webhook ──────────┘
```

## Data model (new migration; old `checkouts`/`agent_sessions` per open O12)

| Table | Purpose | Key fields |
|---|---|---|
| `profiles` | Seeded demo personas | name, role (`fan`/`organiser`), paypal sandbox email hint |
| `events` | Event | organiser_id, title, venue, starts_at, ends_at, status, refund_policy_text, refund_rule (jsonb), release_cutoff_at |
| `ticket_tiers` | Tier per event | event_id, name, price_cents, capacity, sold_count |
| `orders` | Primary purchase | buyer_id, total_cents, status, paypal_order_id, paypal_capture_id |
| `tickets` | One seat | tier_id, owner_id, order_id, ticket_number, status, source_capture_id, unit_price_cents |
| `standby_requests` | A fan's request and hold | fan_id, event_id, quantity, accepted_tier_ids, max_price_cents, conditions_text, conditions (jsonb), status, paypal_order_id, authorization_id, authorized_cents, honor_expires_at, expires_at |
| `settlements` | One resale of one ticket | ticket_id, request_id, new_ticket_id, capture_id, refund_id, refund_cents, status, idempotency_key |
| `policy_readings` | Each reading of a policy by the model | event_id, policy_text, status (`proposed`/`rejected`/`confirmed`/`superseded`), rule, model_output, problems, model |
| `agent_actions` | Action log | actor, kind, subject ids, reason, paypal_ref, request/response summary, created_at |
| `paypal_webhook_events` | Inbox | paypal_event_id (unique), type, payload, verified, processed_at |

All money is integer cents, USD. `src/lib/money.ts` holds the only conversions.

## State machines

**Ticket:** `valid` → `released` → `transferred` (holder's old ticket; new `valid` ticket issued to fan)
`released` → `valid` (holder takes it back, or cutoff passes with no match; then `returned_at` is set)
All three moves run in Postgres functions: `release_tickets`, `take_back_ticket`, `return_unmatched_tickets`.

**Standby request:** `draft` → `authorized` → `matched` → `settled`
`authorized` → `cancelled` | `expired` (hold voided) | `failed` (capture failed)

**Settlement** (one row per ticket): `pending` → `captured` → `transferred`
`pending` → `capture_failed` (no refund, request `failed`, try next request)
`captured` → `refund_failed` (ticket not transferred, D52; retried on the next matching run)
`captured` → `refunded` (refund done at PayPal, transfer write failed; retried without refunding again)

## Refund rule (`src/lib/refund-rule.ts`, version 1)

`{ version: 1, clauses: [{ tier_id, tier_name, within_hours_of_start, percent, fee_cents, quote }] }`

- Exactly one general clause (no tier, no window) is required; no two clauses share a scope.
- Which clause applies (D40): an active time window beats clauses without one; the tightest
  active window wins; at the same window a tier clause beats a general one.
- Amount (D41): `floor(price x percent / 100) - fee`. Computed at resale time (D35) from the
  rule copied onto the ticket at release (`tickets.release_rule`, D36).
- Percent is 1-100 and no clause may pay $0 for a tier (D44): "no refund" limits on ordinary
  refunds create no resale clause.
- Flow: `POST /api/manage/events/[id]/policy/read` stores a validated reading;
  `.../policy/confirm` takes only the reading id and publishes text + rule in the
  `confirm_policy_reading` RPC. The browser never sends a rule.

## PayPal flows

| Step | API | Notes |
|---|---|---|
| Buy ticket | Orders v2 create (`intent=CAPTURE`), capture | Server computes amount; verify `COMPLETED` before issuing tickets |
| Standby hold | Orders v2 create (`intent=AUTHORIZE`), authorize after buyer approval | Amount = quantity × highest accepted tier price, capped by max price |
| Match | Payments v2 capture authorization | Capture actual price (≤ authorized), `final_capture=true`, remainder released |
| Refund holder | Payments v2 refund capture | Partial refund of the holder's original capture, amount from refund rule |
| Cancel / expire | Payments v2 void authorization | |
| Keep hold alive | Payments v2 reauthorize | After the 3-day honor period, within 29 days (open O3) |
| Reconcile | Webhooks + verify signature | Re-fetch the resource from PayPal; never trust event order |

Every mutating call carries a `PayPal-Request-Id` derived from our row id, so retries are safe.

## Settlement transaction

1. `begin_settlement` RPC: lock the request and the released tickets, confirm all are still
   eligible, insert one `settlements(pending)` row per ticket, set the request to `matched`.
2. Capture the authorization once for the whole request (D50). On refusal:
   `fail_settlement_capture` marks `capture_failed`, the tickets stay `released`, the next
   request is tried.
3. Refund each holder's original capture for `refund_cents`.
4. `complete_settlement` RPC, per ticket: record the refund, mark the old ticket
   `transferred`, insert the fan's new ticket, settle the request when all its tickets are
   done, write `agent_actions`.

Matching runs after every release and every placed hold (D51). Details: `features/settlement.md`.

A seat can never be sold twice: step 1's row locks and the unique index on live settlements per ticket guarantee it.

## AI workflows (OpenAI, strict JSON schema, re-validated with Zod)

| Workflow | Input | Output | Code check afterwards |
|---|---|---|---|
| `read_policy` | Organiser's policy text | Structured refund rule + quoted source sentence per clause | Quote must appear verbatim; percentages and deadlines in range; organiser confirms |
| `parse_conditions` | Fan's free-text conditions | Structured conditions (same tier, decide-by time) | Unknown conditions are kept as text and shown, never silently dropped |
| `propose_matches` | Released seats + eligible requests | Allocation list with a reason each | Every pair re-validated for tier, quantity, price cap, conditions, queue tie-break; invalid proposals discarded; rule-based fallback |
| `command` | User sentence + tools (`find_event`, `my_tickets`, `my_standby`, `preview_release`, `preview_standby`) | A proposed action for the user to confirm | Tools are read-only; the action runs only through the normal confirmed routes |

No model output moves money directly. Model calls are capped per request and time-boxed; on
failure the UI says so and the rule-based path continues.

## Sponsor tools

- **Render:** hosts the app; needs a public URL for webhooks (open O10).
- **AG Grid:** organiser data grid. **Bryntum:** organiser calendar (open O9).

## Demo durability

Judging runs Dec 1-15, 2026. Seed data uses dates relative to "now" with a reseed script, so
events are always upcoming and holds are always inside PayPal's 29-day window.
