# Status

Updated: 2026-11-10

**Phase:** TODO items 1-2 done. Items 3 (buy) and 4 (standby) are built; their gates need a
human to approve a payment and a hold in the PayPal sandbox popup. Next to build: item 5, F4
Release a seat.

| Area | State |
|---|---|
| Schema | Three migrations applied: foundation, `fulfil_order` RPC, `standby_requests` |
| Events (F1) | List and event page with tiers, availability, refund policy, release cutoff, standby count: verified in the browser |
| Buy (F2) | Create order (server-computed total), capture, verify, issue tickets via RPC, auto-refund on oversell, My tickets page. Verified: real sandbox order created; 401/400/409/404 paths; capture before approval is refused. **Not verified:** a completed capture and ticket issuance |
| Standby (F3) | Create request (sold-out tiers only, one per fan per event), AUTHORIZE order, authorize, cancel with void, expiry sweep, Standby page. Verified: real sandbox AUTHORIZE order created with the right hold; rejection paths. **Not verified:** a placed authorization and a void |
| Checks | typecheck, lint, 13 unit tests and a production build pass |
| AI | Key works; no workflow built yet |
| Deploy | Not started |

**Why the two gates are open**
- Approving in PayPal means signing in to a sandbox buyer account on PayPal's site, which
  the coding agent does not do. The user approves; the agent verifies the result.

**Notes for later work**
- `SUPABASE_DB_URL` must be the Session pooler URL; the direct database host is IPv6-only.
- `seed.sql` is one `do` block because the CLI's `db query` runs a single statement.
- Seeded "sold" tickets have no PayPal capture and cannot be released. Holder personas buy
  the last 1-3 seats of nearly sold-out tiers for real; that also makes the tier sold out,
  which is what enables standby.
- Free-text standby conditions are stored but not parsed yet (TODO item 9).
- Holds older than PayPal's 3-day honor period need reauthorizing before capture
  (`honor_expires_at` is stored; reauthorize belongs to settlement, TODO item 6).
- The PayPal button reads "Pay with PayPal" for holds too; the dialog text explains it is a hold.

**Known risks**
- Deadline: Nov 12, 2026, 12:00 pm Pacific.
- The rules exclude Quebec residents from prizes; the user has not confirmed eligibility.
- Hosted demo must stay working through judging (Dec 1-15, 2026).
