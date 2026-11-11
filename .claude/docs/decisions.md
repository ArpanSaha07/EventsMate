# Decisions

Rule: if a choice is not listed under **Decided**, it is open. Ask the user with
AskUserQuestion, then move it here with the date. Never settle an open item yourself.

## Decided (2026-11-10, by the user)

| # | Topic | Decision |
|---|---|---|
| D1 | Product | Sold-out-seat resale agent on our own ticketing platform (replaces the event concierge idea) |
| D2 | Name | EventsMate |
| D3 | Platform | Events are hosted and sold only on EventsMate; no third-party ticketing integration |
| D4 | AI provider | OpenAI |
| D5 | Sign-in | Demo persona switcher with seeded people; no passwords |
| D6 | Locale | USD; seeded events in San Francisco |
| D7 | Standby scope | One specific event per request |
| D8 | Ticket model | Tiers per event (own price and capacity); no numbered seats |
| D9 | Matching | Agent optimises allocation to fill the most requests completely; oldest request breaks ties; rules validate before money moves |
| D10 | Settlement order | Capture the fan's hold first, then refund the holder, then transfer the ticket |
| D11 | Refund amount | Organiser policy per event: plain text plus a structured rule the AI extracts |
| D12 | No match by cutoff | Ticket returns to the holder; no refund |
| D13 | AI surfaces | Agent command bar, refund policy reader, agent matching |
| D14 | Extra scope | PayPal webhooks in; all other extras go to `future.md` |
| D15 | Sponsor tools | Render (hosting), AG Grid, Bryntum |
| D16 | Agent docs | `.claude/` is canonical; `.agents/` is left untouched |
| D17 | Stack | Keep Next.js 16, React 19, TypeScript, Tailwind 4, shadcn/ui, Zod, Supabase Postgres, PayPal server SDK + JS SDK v6, Vitest |
| D18 | UI layout | Role-based workspace: top nav, persona switcher, sandbox badge, normal pages per role, and a persistent agent bar at the bottom. Buttons and the agent both end in the same confirm card for any money or ticket action |
| D19 | Visual tone | Calm light: off-white surface, charcoal text, one teal accent, generous spacing. Light theme only |
| D20 | Database workflow | Hosted Supabase; migrations applied with the Supabase CLI (`npm run db:push`, `npm run db:seed`) using `SUPABASE_DB_URL`, which must be the Session pooler URL (the direct host is IPv6-only) |
| D21 | Old schema | Replaced. One migration per feature from here on |
| D22 | Personas | Seven switchable: 1 organiser, 3 holders, 3 fans (names in `supabase/seed.sql`, approved 2026-11-10) |
| D23 | Env file | Lives at `frontend/.env.local` |

## Open (ask when the feature is reached)

| # | Topic | Needed for |
|---|---|---|
| O2 | OpenAI model ID | F5-F7 |
| O3 | How long a standby request lasts by default, and the maximum (PayPal holds last 29 days; honor period 3 days, then reauthorize) | F3 |
| O4 | Release cutoff: how long before the event an unmatched seat returns to the holder | F4 |
| O5 | Partial fills: may a request for 3 seats be offered 2? | F5 |
| O6 | Who absorbs PayPal's non-refunded fee when a holder is refunded | F5, F6 |
| O7 | Matching trigger: on every release, on a timer, or both | F5 |
| O8 | Notifications: in-app only, or email as well | F3-F5 |
| O9 | Where exactly AG Grid and Bryntum appear, and Bryntum trial licence acceptance | F8 |
| O10 | Render service shape (web only, or web plus worker/cron) and plan | Deploy, F10 |
| O11 | Whether the old `EventsMate_Coding_Agent_Brief.md` is deleted or kept as history | Cleanup |
| O14 | Voice input for the command bar | F7 |
