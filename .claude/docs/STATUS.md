# Status

Updated: 2026-11-10

**Phase:** TODO item 1 (Foundation) is done and verified. Next: item 2, F1 Events and tiers.

| Area | State |
|---|---|
| Docs and decisions | Current; open decisions listed in `decisions.md` |
| Schema and seed | Applied to the hosted Supabase project: 8 profiles, 6 events, 9 tiers, 268 filler tickets |
| Database scripts | `npm run db:push` and `npm run db:seed` work |
| App shell | Header, nav, sandbox badge, persona switcher, toasts: verified in the browser |
| Routes | `/api/session`, `/api/events` (with tiers), `/api/health`: verified, including forged-cookie and unknown-id rejection |
| Integrations | Supabase, PayPal sandbox credentials, OpenAI key and model all pass `/api/health` |
| Checks | typecheck, lint and 8 unit tests pass |
| PayPal | Credentials accepted; no order created yet |
| AI | Key works; no workflow built yet |
| Deploy | Not started |

**Notes for later work**
- `SUPABASE_DB_URL` must be the Session pooler URL; the direct database host is IPv6-only.
- `seed.sql` is one `do` block because the CLI's `db query` runs a single statement.
- `supabaseAdmin()` uses only the origin of `SUPABASE_URL`, so a pasted `/rest/v1/` suffix is tolerated.
- Seeded "sold" tickets have no PayPal capture and cannot be released. Holder personas buy
  the last 1-3 seats of nearly sold-out tiers for real in the sandbox.

**Known risks**
- Deadline: Nov 12, 2026, 12:00 pm Pacific.
- The rules exclude Quebec residents from prizes; the user has not confirmed eligibility.
- Hosted demo must stay working through judging (Dec 1-15, 2026).
