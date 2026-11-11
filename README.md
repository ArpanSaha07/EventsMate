# EventsMate

**An AI agent that fills empty seats at sold-out events.**

Fans go on standby with a PayPal hold. When a ticket holder can't make it, the agent matches
the released seat to a waiting fan, captures the hold, refunds the holder under the organiser's
policy, and transfers the ticket. The holder is refunded only from a completed resale, so the
organiser never loses money.

Built for the PayPal AI Hackathon (November 2026).

> **Status: in development.** The table below says what works today. This README is updated as
> each feature lands.

## How it works

1. **Standby.** A fan requests seats at a sold-out event (quantity, accepted tiers, price cap,
   optional conditions in plain words) and approves one PayPal authorization. Nothing is charged.
2. **Release.** A holder says they can't attend. They see what they would get back and why,
   then release the seat. It stays theirs until resold.
3. **Match and settle.** The agent allocates released seats to requests, then for each match:
   capture the hold → refund the holder → transfer the ticket.
4. **Organiser view.** Seats recovered, revenue kept, and a log of every action with its
   PayPal reference.

## Where AI is used

| Surface | What the model does | What code checks |
|---|---|---|
| Matching | Proposes which requests get which released seats | Tier, quantity, price cap, conditions and queue order, before any money moves |
| Refund policy reader | Turns the organiser's plain-language policy into a structured rule | Quotes must appear in the policy; organiser confirms |
| Command bar | Turns a typed sentence into a proposed action | The user confirms; the action runs through the normal routes |

## PayPal usage (sandbox only)

Orders v2 (capture and authorize intents) · Payments v2 (capture authorization, void,
reauthorize, refund) · Webhooks with signature verification · JavaScript SDK v6 for buyer approval.

## Honest scope

- Payments run in the **PayPal sandbox only**. No real money moves.
- Events are **seeded demo events** hosted on EventsMate. Tickets are not valid anywhere else.
- One merchant account; no payouts to organisers.
- Sign-in is a demo persona switcher, not real authentication.

## Build status

| Feature | State |
|---|---|
| Project scaffold, health check | Done |
| Schema, seed, persona switcher, app shell | Done |
| Events and tiers | Done |
| Buy a ticket | Built; payment approval not yet exercised end to end |
| Standby hold | Built; hold approval not yet exercised end to end |
| Release a seat | Not started |
| Matching and settlement | Not started |
| Refund policy reader | Not started |
| Command bar | Not started |
| Organiser dashboard | Not started |
| Webhooks and hosted demo | Not started |

## Stack

Next.js 16 (App Router, Route Handlers) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui ·
Zod · OpenAI · Supabase Postgres · PayPal server SDK and JS SDK v6 · AG Grid · Bryntum ·
Render · Vitest.

The app lives in `frontend/`. There is no separate backend service.

## Local setup

Requires Node.js 22+.

```bash
cd frontend
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000
```

The home page and `GET /api/health` show a live check for each integration.

1. **Supabase.** Create a project at supabase.com. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   and `SUPABASE_DB_URL` (Connect > Session pooler connection string; the direct connection is IPv6-only). Then run
   `npm run db:push` to apply migrations and `npm run db:seed` to load demo data.
   `db:seed` wipes and reloads everything; event dates are relative to today, so re-run it
   whenever the demo needs resetting.
2. **PayPal sandbox.** In the developer dashboard create a Merchant app; set
   `PAYPAL_CLIENT_ID`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID` (same value) and `PAYPAL_CLIENT_SECRET`.
   Note a sandbox Personal account to pay with.
3. **OpenAI.** Set `OPENAI_API_KEY` and `OPENAI_MODEL`.
4. **Session secret.** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   into `SESSION_SECRET`.

## Scripts (run in `frontend/`)

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | Route type generation + `tsc` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run db:push` | Apply new migrations (Supabase CLI) |
| `npm run db:seed` | Wipe and reseed demo data |

## Project docs

Product scope, decisions and architecture are in [`.claude/docs/`](.claude/docs/).

## License

MIT. See [LICENSE](LICENSE).
