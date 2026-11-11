# Plan with AI chat

Updated: 2026-11-11 · Decision: D49 · Status: **working, demo extra (not a main feature)**

A chat at `/plan` that answers questions about the events on EventsMate and about the
signed-in persona's own tickets and standby requests.

## Scope

In scope:

- Answer questions about events from the live catalog: by name, topic, category, date, venue
  or price.
- Show matching events with tickets available first, then sold-out events under
  "Sold out · join standby". If only one group has matches, only that group is shown.
- "Sold out only" and "available only" requests show just that group.
- Per-ticket price caps ("under $15") and total budgets ("two workshops, $40 total").
- A reply about a single event lists its date, venue and tiers, and offers to buy (seats left)
  or join standby (sold out). Both open the normal `BuyDialog` / `StandbyDialog`.
- Personal questions: my tickets, what is next for me (with overlap warnings), standby status.
  These need a persona to be selected.
- Short answers about how EventsMate works.

Out of scope:

- pgvector, embeddings or any search index (the catalog is small enough to send whole).
- Paying or placing a hold from inside the chat without the confirm dialogs.
- Saved chat history: the conversation lives in the browser tab only.
- Standby across several events in one request (D7).
- Events that are not on EventsMate.

## How it works

1. `PlanChat.tsx` posts the conversation to `POST /api/plan`. For earlier assistant replies it
   appends the titles of the events that were shown, so follow-ups ("the sold out one",
   "something else") can be resolved.
2. The route loads every published upcoming event with `listEvents()` (Supabase, live seat
   counts, at most 50) and the current persona.
3. `selectEvents()` in `lib/discovery/planner.ts` sends the model the whole catalog
   (`buildCatalog()`), one line per event with a short ref (`E1`, `E2`, ...). The model returns
   a strict JSON object (`selectionSchema`): intent, event refs, availability filter, price cap,
   total budget and a one or two sentence reply.
4. `resolveSelection()` in `lib/discovery/catalog.ts` decides what is shown: unknown refs are
   dropped, sold-out status and prices are recomputed from the rows, the caps are enforced, and
   the result is split into `available` and `soldOut`.
5. `planEvents()` writes the reply. Event facts (date, venue, tiers, seats) are written by code
   from the rows. The model's sentence is used only when code removed none of its picks.
6. If the model call fails, `fallbackSelect()` matches keywords against titles and
   descriptions so the chat still answers.

Model id comes from `OPENAI_MODEL` (D33). The model never moves money or changes state; it only
proposes which events to show (rule 4).

## Files

| File | Role |
|---|---|
| `frontend/src/app/plan/page.tsx` | Page |
| `frontend/src/components/discovery/PlanChat.tsx` | Chat UI, the two result sections, dialogs |
| `frontend/src/components/discovery/ActionPrompt.tsx` | Buy / join standby prompt |
| `frontend/src/components/discovery/SuggestionChips.tsx` | Starter questions |
| `frontend/src/components/discovery/PersonalScheduleViews.tsx` | Tickets, schedule and standby views |
| `frontend/src/app/api/plan/route.ts` | API route |
| `frontend/src/lib/discovery/planner.ts` | Model call, intent handlers, reply text |
| `frontend/src/lib/discovery/catalog.ts` | Catalog text, schema, validation and split, keyword fallback |
| `frontend/src/lib/discovery/types.ts` | Shared message types |
| `frontend/tests/planner.test.ts` | Unit tests (model call mocked off, fallback path) |

## Current state

Verified on 2026-11-11 against the real database and OpenAI:

| Check | How | Result |
|---|---|---|
| A named sold-out event returns that event with a standby prompt | API and browser | Pass |
| "Suggest some sold out events" returns only sold-out events | API | Pass |
| "Share all the available events" returns only events with tickets | API | Pass |
| "Show me all events" returns available first, sold out second | API | Pass |
| Mixed topic query shows both sections | Browser | Pass |
| Follow-up "tell me more about the sold out one" | Browser | Pass |
| Weekend filter, price cap, total budget | API | Pass |
| No match ("any jazz concerts?") gives a plain "nothing found" reply | API | Pass |
| typecheck, lint, 80 unit tests, production build | Commands | Pass |

Not verified after the D49 rewrite:

- Buying a ticket from the chat prompt through to a captured PayPal order.
- Joining standby from the chat prompt through to a placed hold.
- My tickets, what is next and standby status replies in the browser (their code was not
  changed; unit tests pass).

## Lackings and bugs

| # | Type | Description |
|---|---|---|
| 1 | Lacking | Loose topic queries depend on the model's judgement. "Find me AI agent events" returned seven events but left out the sold-out "Agents & Payments Hack Night"; asking by name or for "payments or hacking" finds it. |
| 2 | Lacking | An event counts as sold out only when every tier is sold out. An event with one sold-out tier (for example a full VIP tier) is listed under "Tickets available" and is not returned for "sold out events". |
| 3 | Bug | Personal replies (my tickets, what is next, standby status) contain markdown (`**bold**`, `[My tickets](/tickets)`) but the bubble renders plain text, so the symbols show literally. |
| 4 | Lacking | The model's sentence is not fact-checked. It is told to use only catalog facts, and all listed facts and cards come from the database, but its one or two sentences could still misstate something. |
| 5 | Lacking | The "Make it cheaper", "Only Saturday" and "Show me something else" chips rely on the model reading the conversation; they were not re-tested after the rewrite. |
| 6 | Lacking | The catalog is capped at 50 upcoming events (`listEvents()` limit). Past that, later events are invisible to the chat. |
| 7 | Lacking | When the model call fails the keyword fallback ignores dates and total budgets. |
| 8 | Lacking | `/api/plan` trusts the conversation sent by the browser and has no rate limit, so each message costs one model call. |
| 9 | Lacking | Session preferences are still passed between client and server but are no longer used. |
