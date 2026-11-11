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
| D24 | Order limit | Up to 4 tickets per order, also capped by seats left |
| D25 | Standby length | A request and its hold stay active until the event's release cutoff, then the hold is voided |
| D26 | Release cutoff | 2 hours before the event starts: unmatched released seats return to holders and standby ends |
| D27 | Setup status | Removed from the UI; `/api/health` remains |
| D28 | Standby price cap | Dropped. Resale is at the tier's face price; the hold is quantity x the most expensive accepted tier, the capture is the actual tier price |
| D29 | Standby tiers | Only sold-out tiers can be included in a request |
| D30 | Standby requests | One active request per fan per event |
| D31 | Standby seats | Up to 4 seats per request |

## Decided (2026-11-11, by the user)

| # | Topic | Decision |
|---|---|---|
| D16 | Agent docs (reaffirmed) | Only `.claude/docs` is kept up to date; `.agents/` stays untouched even though it now differs |
| D32 | Build order | The policy reader (F6, TODO item 8) is built before Release a seat (F4, item 5), so refund previews only ever come from AI-read, organiser-confirmed rules. No hand-written or fallback rules |
| D33 | OpenAI model (was O2) | Code reads the model id from `OPENAI_MODEL`; nothing hard-coded. Use a small, cheap model (for example `gpt-5.4-mini`); the user sets the value in `.env.local` and on Render |
| D34 | PayPal fee on refunds (was O6) | The organiser absorbs it. The holder receives exactly what the policy rule gives |
| D35 | Refund timing | The refund amount is computed when the seat is resold, using the time window active at that moment. The release preview shows the amount now and when and to what it changes |
| D36 | Policy edits | A released ticket keeps a copy of the confirmed rule from the moment of release; a later policy change applies only to later releases |
| D37 | Bad policy reading | Reword and re-read only. No manual editing of the structured rule; nothing is confirmed until the policy reads cleanly, so every clause traces to a verbatim sentence |
| D38 | Cutoff return | Sweep on read: before tickets or released seats are read, released tickets past the cutoff return to `valid` in one database function. A cron may call the same function after deploy |
| D39 | Rule format | Clauses of: percent of the price paid, flat fee, optional named tier, optional "within N hours of the start" window. Percent is 1-100 (D44). Exactly one general clause is required |
| D40 | Rule precedence | An active time window beats any clause without one; the tightest active window applies; at the same window, a tier-specific clause beats a general one |
| D41 | Refund rounding | Percentage is rounded down to the cent, the flat fee is subtracted after, and the result is never below $0 |
| D43 | Hand-written rules (amends D32) | The policy reader is not on the main demo path. An event whose policy text the reader cannot read cleanly gets a hand-written rule by migration so release is never blocked. "No refunds within 24h." is read as a full refund whenever the seat is resold (see D44) |
| D44 | Resale always pays | A resold seat always pays the holder something. "No refund" wording and "full refund up to N hours before" time limits are about ordinary refunds from the organiser, not resale, so they create no resale clause: the general clause applies right up to the release cutoff. Explicit resale windows ("75% within 24 hours") still apply. Code rejects any rule that would pay $0 for a ticket type |
| D45 | Releasing several tickets | "Release seat" opens one confirm card with that ticket ticked and the holder's other releasable tickets for the same event as checkboxes; one confirmation releases the selection |
| D46 | Take back | One click, no confirm card; a toast reports the result |
| D47 | Notifications (was O8) | In-app only: status and a short explanation on My tickets and Standby. No email |
| D48 | Agent docs sync (amends D16) | `.claude/` stays canonical. After the `commit-msg` skill, `scripts/sync-agents.sh` asks Codex to mirror `.claude/AGENTS.md`, `docs/` and `SKILLS/` into `.agents/`; Codex runs with write access to `.agents/` only. Claude does not edit `.agents/` by hand |
| D42 | Organiser UI | A "My events" page at `/manage`, shown only to the organiser persona, for reading and confirming policies; the dashboard (item 11) grows from it |

## Open (ask when the feature is reached)

| # | Topic | Needed for |
|---|---|---|
| O5 | Partial fills: may a request for 3 seats be offered 2? | F5 |
| O7 | Matching trigger: on every release, on a timer, or both | F5 |
| O9 | Where exactly AG Grid and Bryntum appear, and Bryntum trial licence acceptance | F8 |
| O10 | Render service shape (web only, or web plus worker/cron) and plan | Deploy, F10 |
| O11 | Whether the old `EventsMate_Coding_Agent_Brief.md` is deleted or kept as history | Cleanup |
| O14 | Voice input for the command bar | F7 |
