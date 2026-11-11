# Status

Updated: 2026-11-11

**Phase:** TODO items 1-6 and 8 done (the user ticked 3 and 4 after approving in the sandbox;
item 8 was built ahead of item 5 by decision D32). Next to build: item 7, F9 Action log
(`agent_actions` rows are already written by settlement; the page is missing).

| Area | State |
|---|---|
| Schema | Seven migrations applied (the seventh adds settlement: `settlements`, `agent_actions`, `standby_requests.capture_id` / `captured_cents`, RPCs `begin_settlement`, `record_settlement_capture`, `fail_settlement_capture`, `record_settlement_refund_failure`, `complete_settlement`; take back and cutoff return now skip tickets in a settlement) (the fifth sets one hand-written refund rule, D43; the sixth adds release: `tickets.release_rule`, `tickets.returned_at`, RPCs `release_tickets`, `take_back_ticket`, `return_unmatched_tickets`, and strips 0% clauses per D44): foundation, `fulfil_order` RPC, `standby_requests`, policy reader (`policy_readings`, `confirm_policy_reading` RPC, `events.refund_rule_confirmed_at`) |
| Events (F1) | List and event page with tiers, availability, refund policy, release cutoff, standby count: verified in the browser |
| Buy (F2) | Create order (server-computed total), capture, verify, issue tickets via RPC, auto-refund on oversell, My tickets page. Verified: real sandbox order created; 401/400/409/404 paths; capture before approval is refused. **Not verified:** a completed capture and ticket issuance |
| Standby (F3) | Create request (sold-out tiers only, one per fan per event), AUTHORIZE order, authorize, cancel with void, expiry sweep, Standby page. Verified: real sandbox AUTHORIZE order created with the right hold; rejection paths. **Not verified:** a placed authorization and a void |
| Policy reader (F6) | Organiser page `/manage`: write policy, model reads it, code validates (verbatim quotes, real tiers, ranges, fee in the sentence, one general clause), organiser confirms; text and rule publish together in one RPC. Event page shows the refund per tier now and when it changes. Verified in the browser and by API against real OpenAI and the database: clean reading, rejected reading, confirm, repeat confirm, role and ownership guards |
| Release (F4) | My tickets: "Release seat" opens one confirm card (tick other tickets for the same event), showing the server-computed refund per ticket, the rule, the policy sentence, any later change and the cutoff. Released tickets stay the holder's, keep a copy of the rule (D36) and have "Take it back". Unmatched tickets return at the cutoff on the next read (D38). Verified against the real database: 30 API/database checks (guards, repeat calls, mixed events, rule copy survives a policy change, take back, cutoff return with the event start moved temporarily) and the release / take back flow in the browser. **Not verified in the browser:** the "Returned to you at the cutoff" note (verified by API only) |
| Settlement (F5) | Rule-based matching runs after every release and every placed hold (D51): oldest request that can be filled completely (D50), one capture per hold, holder refunded from the rule copied at release, ticket transferred only after the refund (D52). My tickets and Standby show the result with PayPal references. Verified in the real sandbox: forced capture failure (hold voided at PayPal) refunded nobody and the seat went to the next request; capture and refund `COMPLETED`; repeat calls change nothing; pages checked in the browser. **Not verified live:** multi-seat requests, a refund failure, an unconfirmed capture, the "seat already waiting" standby dialog. See `features/settlement.md` |
| Plan with AI chat (D49) | `/plan`: each message sends the model the full live catalog (`lib/discovery/catalog.ts`); it proposes event refs and code validates them, recomputes sold-out status and prices, and shows available events first, sold-out second. Keyword fallback if the model call fails. Verified by API and in the browser: named sold-out event, sold-out only, all events, follow-up question. **Not verified after this change:** buying or joining standby from the chat prompt |
| Checks | typecheck, lint and 102 unit tests pass. The production build was not re-run after item 6 |
| AI | `read_policy` built (OpenAI Responses API, strict JSON schema, model id from `OPENAI_MODEL`) |
| Deploy | Not started |

**Why the two gates are open**
- Approving in PayPal means signing in to a sandbox buyer account on PayPal's site, which
  the coding agent does not do. The user approves; the agent verifies the result.

**Notes for later work**
- All 10 events have a refund rule that always pays on resale (D44): 9 read and confirmed through the policy reader, and the
  Bay Area mixer ("No refunds within 24h.") hand-written by migration (D43). A reseed clears
  all rules; they are not in `seed.sql`.
- `OPENAI_MODEL` in `.env.local` is still a large model; D33 asks for a small one (the reader
  was verified with both `gpt-5.4-mini` and the configured model).
- The database holds 4 events that are not in `seed.sql`; a reseed removes them.
- Settlements stuck in `matched` / `refund_failed` are retried only on the next release or
  hold for that event (no timer, D51). Webhooks (item 12) should also call `runMatching`.
- Sandbox state after the item 6 gate: Liam's Hack Night request is `failed` (his hold was
  voided on purpose), Noah holds the resold Hack Night ticket, and Daniel's released Design
  Sprint VIP seat with Maya on standby is still unmatched: any release or hold for that
  event settles it.
- The 2-hour cutoff lives in three places: `RELEASE_CUTOFF_MS` in `rules.ts` and
  `interval '2 hours'` in the release and settlement migrations. Change both together.
- `errorResponse` rethrows Next.js internal signals (`unstable_rethrow`) so the build's
  prerender probe of cookie-reading GET routes no longer logs false errors.
- `SUPABASE_DB_URL` must be the Session pooler URL; the direct database host is IPv6-only.
- `seed.sql` is one `do` block because the CLI's `db query` runs a single statement.
- Seeded "sold" tickets have no PayPal capture and cannot be released. Holder personas buy
  the last 1-3 seats of nearly sold-out tiers for real; that also makes the tier sold out,
  which is what enables standby.
- Free-text standby conditions are stored but not parsed yet (TODO item 9).
- Holds older than PayPal's 3-day honor period are captured directly, without reauthorizing
  (D53); a refused capture closes the request and the next one is tried.
- The PayPal button reads "Pay with PayPal" for holds too; the dialog text explains it is a hold.

**Known risks**
- Deadline: Nov 12, 2026, 12:00 pm Pacific.
- The rules exclude Quebec residents from prizes; the user has not confirmed eligibility.
- Hosted demo must stay working through judging (Dec 1-15, 2026).
