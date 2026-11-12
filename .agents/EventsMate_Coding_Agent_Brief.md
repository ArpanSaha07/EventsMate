# EventsMate - Coding Agent Implementation Brief

**Project:** EventsMate — AI-powered event planning and agent-assisted ticket purchasing  
**Context:** PayPal AI Hackathon, November 2026  
**Status:** One-day hackathon MVP specification  
**Primary objective:** Show a real, end-to-end **AI → event selection → human approval → PayPal sandbox payment → confirmed ticket** workflow.

> **Instructions to coding agent:** Build a working, demonstrable product, not a visual mockup. Prefer the simplest reliable implementation over elaborate abstractions. Implement the critical path first; keep each phase independently testable. Do not claim that a payment occurred without a verified PayPal sandbox capture. Ask for environment secrets only when needed and never commit them. Do not expand scope into third-party ticketing or CampusVibe integration.

## 1. Product definition

### One-sentence pitch
EventsMate is an AI event concierge that understands a user's interests, schedule, location, and spending limit; asks clarifying questions when necessary; selects bookable EventsMate-native events; and prepares ticket purchases for explicit user approval through PayPal.

### Why this is *not* another event management platform
The central experience is **agentic commerce**, not organizer dashboards or an events CMS. Events are a small curated catalog that enables an AI agent to solve the user's problem: *“What should I attend, and can you book it within my budget?”* Unlike conventional event browsing, the agent turns natural language into validated constraints, runs event-search tools, handles trade-offs, prepares a specific cart, and coordinates an authorized sandbox transaction.

### Audience
Students, developers, professionals, and people seeking workshops, meetups, networking sessions, and experiences without manually comparing numerous listings.

### Example demo request
> “Find me two hands-on AI events in Montréal this weekend. My total budget is CAD $60. No schedule conflicts. Book the ones you recommend, but ask me before paying.”

Expected behavior:
1. The agent understands location, date window, theme, and budget.
2. It asks for missing **essential** information only when needed; it does not interrogate the user unnecessarily. Example: “Is your $60 budget for one ticket per event, or the total across all events?” if genuinely ambiguous.
3. It queries the actual event catalog through a server-controlled tool.
4. It picks viable events, explains fit and trade-offs, checks schedule conflicts, and shows a combined total.
5. The user reviews event names, dates, quantities, prices, currency, and total, then presses **Approve and continue to PayPal**.
6. The backend revalidates current event data, ticket availability, pricing, budget, and a checkout-specific approval record; creates a sandbox PayPal order.
7. User approves the transaction in the **real PayPal sandbox checkout UI**.
8. The server captures and verifies PayPal payment, then issues internal EventsMate tickets and displays a confirmation with PayPal transaction/order references.

**Important:** Human approval of the plan and PayPal's own buyer approval are distinct checkpoints. The agent must never silently charge the user. “Agentic” describes planning and coordinating authorized actions, not bypassing payment consent.

## 2. MVP boundary — non-negotiable

### P0 — must work end-to-end
- Attractive, responsive home/chat UI with prompt suggestions and a clear sandbox badge.
- Natural-language intent handling through the **OpenAI API** with structured outputs/tool calls.
- Clarification turn when required information is missing; preserve conversation context through a session ID.
- At least one **genuine server-side tool invocation** to search EventsMate-native events from **Supabase** (not invented event details in model output).
- Seeded catalog of ~8–12 realistic **fictional or clearly demo-labeled EventsMate-native events**, with dates in the future relative to the demo, event start/end timestamps, location, category/tags, currency, integer-cent price, and inventory.
- Event recommendation cards with reasoning, availability, schedule-conflict check, and total budget calculation.
- User can select/deselect recommendations and see the server-validated revised total.
- Explicit approval checkpoint showing an exact order summary.
- PayPal **sandbox** create-order and capture-order integration with real PayPal responses.
- Save checkout/payment status and issue tickets only after successful, verified capture.
- Confirmation page showing event tickets, amount, PayPal order ID, and a verified payment/capture status.
- README and local setup; test one complete purchase using sandbox accounts.

### P1 — only if P0 is stable
- Suggested itinerary with multiple tickets purchased together in a single merchant order.
- Lightweight chat transcript/history in Supabase.
- A “budget exceeded” correction: agent proposes a less expensive itinerary, rather than attempting checkout.
- Graceful recovery for declined/cancelled checkout and insufficient tickets.
- Add-to-calendar `.ics` ticket downloads.
- Small explanation panel displaying tool calls/actions (“Found 9 events”, “Checked budget”, “Awaiting your approval”, “Captured payment”).

### Explicitly out of scope
- Scraping Meetup, Eventbrite, Luma, or buying third-party tickets.
- CampusVibe integration, organizer portal, event creation UI, payouts, split payments, refunds, escrow, subscriptions, authentication/complex profiles, email workflows, receipt OCR, real-world payment processing, multi-agent architecture, live seat-locking/production inventory reservations.
- A broad recommendation engine, embeddings/RAG, vector search, maps, complicated calendar integrations, or autonomous payment execution without approval.

## 3. Proposed stack and reasons

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js App Router + React + TypeScript | Single codebase and fast iteration |
| Backend | Next.js **Route Handlers** on Node.js runtime | No separate backend deployment |
| UI | Tailwind CSS + shadcn/ui + Lucide icons | Fast, accessible components |
| Validation | Zod | Enforce all tool/route input contracts |
| AI | OpenAI Responses API with function calling / structured JSON | Typed intent, clarifications, tool coordination |
| Payments | PayPal **Orders v2** through official server SDK or REST API | Verified sandbox create/capture |
| Browser checkout | PayPal JavaScript SDK v6, ideally `@paypal/react-paypal-js` | Official buyer approval experience |
| Storage | Supabase Postgres | Hosted relational data and quick seeding |
| Deployment | Vercel | Easy Next.js deployment; Node.js runtime for payment handlers |
| QA | Vitest for units; one browser sandbox smoke test | Coverage of core payment safety and demo flow |

**SDK preference:** PayPal's official Next.js guide uses `@paypal/react-paypal-js` and `@paypal/paypal-server-sdk`. This project uses Route Handlers by design, not Server Actions. Reuse the guide's server-side create/capture approach inside `/api/checkout/...` endpoints; check package APIs against the installed version. Alternatively use direct `fetch` to PayPal Orders v2 from server-only modules if SDK setup blocks progress. **Do not mix tutorial code from older JS SDK versions with v6 signatures without checking docs.**

**OpenAI implementation:** Keep the agent lightweight: one orchestrator and **explicit allowlisted tools**, not a free-form code-executing agent. Use current OpenAI Node SDK (`openai`) and model configurable via `OPENAI_MODEL`. Strictly validate model/tool output. The model can propose event IDs and recommendations, but the server computes prices and determines what can be purchased.

## 4. Main user workflow / state machine

```text
User enters natural language request
  |
  v
POST /api/chat — OpenAI agent extracts constraints (structured)
  |
  +-- Missing material constraint? -> Ask ONE targeted follow-up
  |                                  -> User responds -> Merge saved constraints -> retry
  |
  v
Agent invokes search_events({ city, date_range, tags, max_total_budget, ... })
  |   -> Server queries Supabase with validated filters
  |   -> Server returns authoritative event IDs, prices, inventory, schedules
  |
  v
Agent builds proposed itinerary (rationale + event IDs)
  |   -> Server checks availability, time overlaps, currency, budget
  |   -> If infeasible: ask user to modify constraints or propose alternative
  |
  v
Recommendation cards + editable cart + exact amount
  |
  v
User clicks Approve and continue to PayPal
  |   -> POST /api/checkout/prepare
  |   -> Server re-fetches products, calculates integer-cent total,
  |      validates active stock and records approved checkout snapshot
  |
  v
POST /api/checkout/create-order
  |   -> Confirm approved snapshot unchanged
  |   -> Create PayPal sandbox order using server secret
  |   -> Record PayPal order ID and status (CREATED)
  |
  v
PayPal JS SDK renders buyer approval UI
  |   -> Buyer approves within PayPal sandbox
  |
  v
POST /api/checkout/capture-order
  |   -> Validate order belongs to this checkout/session
  |   -> Capture using server credentials
  |   -> Verify COMPLETED capture, amount, currency, merchant order ID
  |   -> Idempotently mark order PAID and create ticket rows
  |
  v
Confirmed tickets + PayPal order/capture reference + success screen
```

**Never:** call PayPal from model-generated arbitrary arguments; trust a browser-supplied price; use a simulated PayPal success screen; fulfill tickets based solely on `onApprove` without confirmed server capture.

### Clarification strategy
Required purchase-related constraints: date/time window, city or catalog scope, desired event count or inferred sensible default, ticket quantity (default **1** if not specified, visibly editable), currency budget (optional but encouraged). If the user simply says “Find AI events,” infer harmless defaults from a visible UI setting (e.g., Montréal, next 7 days, 1 ticket), show those assumptions, and ask at most one high-value question if the query cannot be usefully answered. Do not imply default budget approval. Budget can be optional for discovery but must be explicitly visible in checkout.

Use a typed state resembling:

```ts
type TripConstraints = {
  city?: string;
  dateFrom?: string; // ISO date/time; timezone-aware boundary derived on server
  dateTo?: string;
  interests: string[];
  maxBudgetCents?: number;
  currency: 'CAD';
  desiredEventCount?: number;
  ticketQuantity: number;
  mustAvoidConflicts: boolean;
};

type AgentOutcome =
  | { kind: 'clarification'; question: string; constraints: TripConstraints }
  | { kind: 'recommendations'; eventIds: string[]; explanation: string; constraints: TripConstraints }
  | { kind: 'no_results'; explanation: string; suggestions: string[] };
```

The server uses timezone-aware timestamps from Supabase. Use `America/Toronto` for sample Montréal events; display human-readable timezone, never assume every user is located there. All monetary values in **integer cents**; MVP catalog uses CAD only to avoid FX complexity.

## 5. Agent design and safe tools

**Agent policy:** It is a concierge for EventsMate-native events only. It should discover and recommend catalog entries, not fabricate listings or claim real external registrations. It may describe potential purchasing steps but cannot independently authorize payment.

Tools implemented as ordinary server-side TypeScript functions with Zod schemas:

```ts
search_events({ city?, from?, to?, tags?, maxPriceCents?, limit? })
get_event_details({ eventIds: string[] })
validate_itinerary({ eventIds: string[], quantities, maxBudgetCents? })
```

- `search_events`: parameterized Supabase query with date, location, and optional tag filters; return event IDs, names, prices, availability and start/end timestamps. Treat empty results honestly.
- `get_event_details`: retrieve canonical event data, not client data.
- `validate_itinerary`: deterministic server utility for counts, conflicts, inventory, total budget, single currency and price limits; can be an internal service rather than an LLM-exposed tool.
- **Payment actions are *not* autonomous LLM tools in P0**. The backend checkout routes execute them after an explicit, durable approval. Present them as agent-coordinated actions in UI, with the boundary clearly stated.

Orchestrator suggestions:
1. System instructions: use real tool data only; avoid long responses; ask only missing critical questions; do not claim payment completed absent a verified tool response.
2. Extract intent using strict JSON/Zod output; merge with session constraints.
3. If unresolved, return a clarification (no search required).
4. Otherwise invoke the actual `search_events` function through model function calling. Cap tool rounds (e.g. 3) to avoid infinite loops.
5. Generate concise recommendations with exact IDs from returned results; validate IDs and business logic once more on the server.
6. Persist session constraints and optionally transcript.
7. Return typed UI payload: assistant message, recommendation cards, totals/validation warnings, state.

Error policy: Rate-limit requests where practical; stop loops, handle AI/PayPal API failures clearly; keep sensitive implementation traces out of the client response. If OpenAI fails, surface retry rather than pretend an agent acted.

## 6. Frontend UX and screens

### UI style
Create a clean, credible, **light** product aesthetic: soft off-white surface, charcoal text, restrained teal/blue accent, comfortable spacing, clear hierarchy, modern typography. Avoid generic neon-purple “AI startup” UI. Use shadcn/ui `Button`, `Card`, `Badge`, `Input`, `Dialog`, `Skeleton`, `Separator`, and `Alert` selectively. Must be good on a laptop and mobile.

### Landing/chat (`/`)
- Header: EventsMate wordmark, **Sandbox Demo** label, short one-line explanation.
- Left/main: conversation thread and message composer with sample prompt chips.
- Right/below: recommended itinerary and total budget panel; empty state before search.
- Chat state includes `asking_clarification`, `searching`, `planning`, `proposed`, `awaiting_approval`, `checkout`, `paid`, `failed`.
- Show **real** tool activity such as “Searching EventsMate events”, “Checking schedule conflicts”, “Preparing purchase”; do not fake a live action log.
- Recommendation cards show category, venue/city, date/time, price, remaining tickets, and why picked.
- User can remove events from cart and request new recommendations. Budget remaining shown only if budget specified.

### Checkout summary (dialog or `/checkout/[checkoutId]`)
- Accurate list of event tickets (quantity × price), subtotal, total, currency and PayPal sandbox label.
- A clear, separate **Approve this purchase plan** action.
- After server stores approval, initialize PayPal checkout button; user then approves in PayPal UI.
- Disable payment for sold-out tickets, invalid price, time conflict (if required), or budget exceeded.
- Handle cancel gracefully; no ticket issuance on cancel.

### Success (`/booking/[id]`)
- Show **Payment verified** only after server-validated capture.
- Show confirmed event tickets with reference numbers and date/time/venue.
- Display PayPal order ID, capture ID, total amount and sandbox indicator.
- Optional `.ics` export if time remains.

## 7. Supabase schema (minimal)

Apply migrations in `supabase/migrations/`. Suggested structure:

```sql
create table events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  category text not null,
  tags text[] not null default '{}',
  venue text not null,
  city text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'CAD' check (currency = 'CAD'),
  capacity integer not null check (capacity >= 0),
  sold_count integer not null default 0 check (sold_count >= 0),
  status text not null default 'published' check (status in ('published','cancelled')),
  created_at timestamptz default now(),
  check (ends_at > starts_at),
  check (sold_count <= capacity)
);

create table agent_sessions (
  id uuid primary key default gen_random_uuid(),
  constraints jsonb not null default '{}',
  messages jsonb not null default '[]',
  created_at timestamptz default now()
);

create table checkouts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references agent_sessions(id),
  approved_snapshot jsonb not null,
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'CAD',
  status text not null default 'prepared' check (status in ('prepared','approved','paypal_created','paid','cancelled','failed')),
  paypal_order_id text unique,
  paypal_capture_id text unique,
  created_at timestamptz default now(),
  approved_at timestamptz
);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null references checkouts(id),
  event_id uuid not null references events(id),
  ticket_number text not null unique,
  created_at timestamptz default now(),
  unique(checkout_id, event_id, ticket_number)
);
```

**Notes:** Build one ticket per purchased attendee (quantity 1 initially). For free events, a no-payment RSVP is an optional separate flow; **show at least one paid event in the demo**. Use a seeded catalog and guest sessions; an actual auth system is unnecessary for this prototype.

**Inventory consistency:** After successful capture, use a **single Supabase Postgres transaction/RPC** that locks affected event rows, validates remaining capacity, increments `sold_count`, sets checkout paid, and inserts tickets idempotently. For this hackathon prototype, avoid contentious near-capacity scenarios by seeding generous inventory. A production system would reserve inventory before payment and include explicit recovery/refund procedures; do not claim this MVP solves that problem. If stock becomes unavailable after payment, flag for manual resolution rather than silently showing success.

**Supabase permissions:** Use a *server-only* service role key for writes and all payment/session operations; never expose it to the browser. Either implement read-only RLS policies for published events or only query events from Route Handlers. No sensitive customer data needed for demo. Session IDs are not robust authentication: do not market the demo as production-secure; bind checkout actions to an HTTP-only signed guest session cookie where feasible, not merely guessable/shared checkout IDs.

## 8. API contracts (Next.js Route Handlers)

```text
POST /api/chat
  input: { sessionId?: string, message: string }
  output: { sessionId, status, assistantMessage, clarification?, recommendations?, constraints? }

GET /api/events
  input: ?city=...&from=...&to=...
  output: { events: Event[] }  // only public event fields

POST /api/checkout/prepare
  input: { sessionId, items: [{ eventId, quantity }], maxBudgetCents? }
  output: { checkoutId, canonicalItems, totalCents, currency, approvalRequired: true }

POST /api/checkout/approve
  input: { checkoutId, confirmation: true }
  output: { checkoutId, status: 'approved' }
  // Require actual user click; snapshot must be unchanged.

POST /api/checkout/create-order
  input: { checkoutId }
  output: { paypalOrderId }
  // Only if explicit approval is recorded, validate immutable amounts.

POST /api/checkout/capture-order
  input: { checkoutId, paypalOrderId }
  output: { status, bookingId, paypalOrderId, captureId }
  // Only after verified PayPal capture; idempotently commit ticket issuance.

GET /api/booking/[checkoutId]
  output: { status, tickets, paypalOrderId, captureId, amount }
  // Check access against signed guest session; sanitize response.
```

API route handlers: set `export const runtime = 'nodejs';` where SDKs require Node. Use `src/app/api/.../route.ts`. Validate all request bodies and enforce amount, rate and inventory constraints server-side. Do not expose PayPal secret, OpenAI API key or Supabase service role key to client components.

## 9. PayPal sandbox integration — implementation requirements

1. Create or select a PayPal **sandbox merchant/business** app; collect Client ID and Secret. Create/use a separate **sandbox personal buyer** account.
2. Follow current PayPal **Next.js checkout** or **Orders v2** docs. Install `@paypal/react-paypal-js` and `@paypal/paypal-server-sdk`, or use a minimal direct REST wrapper from server-only modules. Use official v6 React integration compatible with installed package version.
3. Define `PAYPAL_ENV=sandbox`. Use sandbox endpoints/SDK configuration. Do **not** implement or enable live mode for MVP.
4. `create-order` reads the **approved checkout snapshot** from Supabase and computes/validates its total (amount is not accepted from browser or model). Set proper merchant purchase units, currency and a descriptive event-order label. Persist returned PayPal order ID before exposing it.
5. Render PayPal button and handle PayPal cancellation and errors. After PayPal buyer approves, call server `capture-order`.
6. On server, verify PayPal order is associated with the correct checkout/session, amount/currency match the approved snapshot, and a capture is **COMPLETED**. Do not equate an approved order with completed payment.
7. Make capture **idempotent**: a repeated request must return the same confirmed booking, not create duplicate tickets or repeat a charge. Use PayPal request IDs if applicable, database uniqueness, and query existing status before capture.
8. Store PayPal order and capture reference, checked amount/currency, checkout state and ticket issuance in Supabase. Do not store card data or live credentials.
9. If capture succeeds but persistence fails, preserve order ID and provide a reconciliation/retry route; never claim success without successfully verifying persisted payment and ticket state.
10. At minimum test **success**, **user cancels**, **wrong price rejection**, **duplicate capture retry**, and **budget exceeded**.

**Design compromise:** The MVP supports one merchant (EventsMate) with one aggregated order containing multiple native tickets. It does not pay external event organizers or transfer funds to multiple recipients. Make that explicit in the interface and README.

## 10. Suggested source tree

```text
eventsmate/
├── README.md
├── LICENSE
├── .env.example
├── package.json
├── next.config.ts
├── supabase/
│   ├── migrations/
│   │   └── 001_initial.sql
│   └── seed.sql
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                       # Main agent chat + results
│   │   ├── checkout/[checkoutId]/page.tsx
│   │   ├── booking/[checkoutId]/page.tsx
│   │   └── api/
│   │       ├── chat/route.ts
│   │       ├── events/route.ts
│   │       ├── checkout/
│   │       │   ├── prepare/route.ts
│   │       │   ├── approve/route.ts
│   │       │   ├── create-order/route.ts
│   │       │   └── capture-order/route.ts
│   │       └── booking/[checkoutId]/route.ts
│   ├── components/
│   │   ├── chat/ChatPanel.tsx
│   │   ├── events/EventCard.tsx
│   │   ├── events/ItineraryPanel.tsx
│   │   ├── checkout/CheckoutSummary.tsx
│   │   ├── checkout/PayPalCheckout.tsx
│   │   └── booking/TicketCard.tsx
│   ├── lib/
│   │   ├── ai/agent.ts                  # OpenAI orchestration
│   │   ├── ai/prompts.ts
│   │   ├── ai/tools.ts
│   │   ├── events/search.ts
│   │   ├── events/validate-itinerary.ts
│   │   ├── checkout/service.ts         # approval/checkout lifecycle
│   │   ├── paypal/client.ts            # server only
│   │   ├── paypal/orders.ts            # server only
│   │   ├── supabase/admin.ts           # server only
│   │   ├── session.ts                  # secure guest session cookie
│   │   ├── schemas.ts                  # Zod schemas
│   │   └── money.ts                    # integer cents / formatting
│   └── types/index.ts
└── tests/
    ├── itinerary.test.ts
    └── checkout.test.ts
```

This is a **suggested tree**, not a requirement to scaffold every file before writing functionality. Keep files few and purposeful.

## 11. Environment configuration

Commit an `.env.example` with placeholders, never `.env.local` values:

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=                 # choose currently supported function-calling model
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=    # server-only; never NEXT_PUBLIC_
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=             # server-only
PAYPAL_CLIENT_SECRET=         # server-only
NEXT_PUBLIC_PAYPAL_CLIENT_ID= # public client ID only
SESSION_SECRET=               # securely generated server secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Use a single source of truth for the public PayPal Client ID as appropriate; never expose the secret. Supabase publishable/anon key may be added only if direct client reads are actually implemented; prefer server-side queries for P0.

## 12. Build order for a one-day hackathon

### Phase A — Bootstrap and foundational data (60–90 min)
- Initialize Next.js with TypeScript, Tailwind, App Router and ESLint.
- Install shadcn/ui, Zod, OpenAI SDK, Supabase JS and PayPal SDKs.
- Create Supabase project, migration, seed ~8–12 future demo events (e.g. AI workshops, startup meetups, design sessions, hack nights) and test read query.
- Create `.env.example`, verify no secrets can reach browser.

**Gate:** `/api/events` returns seeded data from actual Supabase.

### Phase B — PayPal vertical slice FIRST (90–120 min)
- Build a minimal checkout flow for **one hardcoded event ID** using canonical price from Supabase.
- Implement approval, server-side PayPal order creation, PayPal buyer approval, server-side capture, and ticket persistence.
- Verify completed capture response and actual ticket in DB.

**Gate:** A real sandbox buyer completes an actual sandbox payment and receives a verified EventsMate ticket. Do not proceed to sophisticated AI UI until this passes.

### Phase C — OpenAI agent and event tools (90–120 min)
- Build `/api/chat`, structured intent extraction and session context.
- Implement clarification response and real `search_events` invocation.
- Recommend catalog events and revalidate budget/conflicts on server.
- Display reasoning with recommendation cards.

**Gate:** A conversational request produces real bookable results, and a follow-up question preserves context.

### Phase D — Product UI polish and end-to-end workflow (60–90 min)
- Chat thread, sample prompts, event cards, itinerary summary, checkout approval dialog, payment button, booking success page.
- Empty/error/loading states; mobile-friendly layout and sandbox indicators.
- Verify selected recommendations match the actual checkout snapshot.

**Gate:** Entire user story works from chat to verified ticket with no developer intervention.

### Phase E — Submission preparation (60–90 min)
- Test key failure paths; update seed/event dates if needed.
- Document local setup, Supabase migration and seed steps, sandbox credentials required, and screenshots.
- Public repository + visible open-source LICENSE.
- Record and publish <3-minute YouTube video of actual functioning workflow.
- Prepare hackathon description, AI/tool explanation and demo access.

**Time protection:** If delayed, use one paid ticket, one city, one attendee, three seeded events, and one simple AI clarification. **Do not sacrifice real PayPal capture, ticket issuance, or submission deliverables for extra features.**

## 13. Tests and acceptance criteria

- [ ] Event search retrieves only Supabase rows and returns no invented events.
- [ ] User can ask an underspecified question and receive a targeted clarification; context survives the answer.
- [ ] The agent selects event IDs drawn from returned tool records.
- [ ] Date/time overlaps are rejected or clearly warned about for `mustAvoidConflicts`.
- [ ] Budget `<=` total comparisons use integer cents and consistent currency.
- [ ] Editing cart invalidates any earlier approval; server recomputes exact total.
- [ ] Client cannot alter an event price or directly submit a transaction amount.
- [ ] PayPal sandbox checkout opens and supports a test buyer approval.
- [ ] PayPal capture is verified **COMPLETED** by backend before tickets are issued.
- [ ] Duplicate capture requests do not create duplicate tickets.
- [ ] Cancelled/failed PayPal checkout does not issue tickets.
- [ ] API and UI failures show meaningful retry/error states, not fake success.
- [ ] App loads on mobile and desktop; main demo works after a fresh browser session.
- [ ] Secrets are excluded from Git, logs and public client bundles.

## 14. Demo script (<3 minutes)

1. **Problem (15–20 sec):** Finding events across options, checking dates, fitting a budget and checking out take too many steps.
2. **Natural-language intent (25 sec):** “Find two AI/startup events this weekend in Montréal under CAD $60.”
3. **AI reasoning/tools (35 sec):** Show clarification if useful, tool-driven catalog search, two recommendations, budget total and conflict-free schedule.
4. **Human approval (20 sec):** Show exact tickets/prices; explicitly approve the plan.
5. **PayPal sandbox purchase (40–50 sec):** Real PayPal buyer approval and server-verified capture.
6. **Outcome and architecture (25 sec):** Display ticket + PayPal references; briefly explain OpenAI tool calling, Supabase-backed event search and PayPal server-side capture.
7. **Impact and future (10 sec):** Future integration possibilities; do not present them as shipped.

Use a stable scripted prompt and prepared sandbox buyer. Be truthful about seeded native events and sandbox-only payments.

## 15. Hackathon rules and deliverables (verified November 10, 2026)

**Official pages:**
- Main: https://paypalaihackathon.devpost.com/
- Resources: https://paypalaihackathon.devpost.com/resources
- Rules: https://paypalaihackathon.devpost.com/rules
- Dates: https://paypalaihackathon.devpost.com/details/dates

**Submission deadline:** **November 12, 2026 at 12:00 PM Pacific Standard Time (3:00 PM Eastern / Montréal)**.

**Project requirements:** Meaningfully integrate the PayPal developer platform **in free sandbox mode** and an AI model/tool/platform; demonstrate a functional application. AI sponsor tools are optional. Judges weigh **technological implementation, design, potential impact, innovation/idea, presentation** equally (subject to official rules).

**Required submission artifacts:**
- Working application (hosted URL **or** complete build/run instructions for judges).
- Project description explaining actual features and functionality.
- Public source repository with source/assets/instructions and a clearly visible open-source license.
- List and explanation of AI/tools used.
- Public YouTube demonstration video **under 3 minutes**, showing the functioning application; avoid unlicensed media.
- Any needed sandbox/demo access instructions; keep real secrets out of public repo.

**Sponsor tools (optional, not required):** AG Grid, APIMatic, Astropods, Bryntum, Channel3, Elastic, KERNEL, Postman, Render, Zapier. For one day, **do not add a sponsor tool just for the logo**. Postman is handy for API testing. Other tools add value only after P0 is complete.

## 16. References for implementation

- PayPal official Next.js checkout guide: https://developer.paypal.com/guides/nextjs-checkout
- PayPal checkout quickstart: https://developer.paypal.com/checkout/integrate
- PayPal Orders v2 API: https://developer.paypal.com/docs/api/orders/v2/
- PayPal Developer dashboard: https://developer.paypal.com/
- OpenAI Responses API and function calling docs: https://platform.openai.com/docs/guides/function-calling
- OpenAI structured outputs: https://platform.openai.com/docs/guides/structured-outputs
- Supabase Next.js quickstart: https://supabase.com/docs/guides/getting-started/quickstarts/nextjs
- Next.js Route Handlers: https://nextjs.org/docs/app/getting-started/route-handlers
- shadcn/ui Next.js installation: https://ui.shadcn.com/docs/installation/next

## 17. Operating instructions for the coding agent

1. Begin with project bootstrap and **Supabase seed + PayPal vertical slice**, not extensive frontend scaffolding.
2. Before each phase, say which acceptance gate you will satisfy. After implementation, run lint/typecheck/tests, verify responses, and give an exact local smoke-test command or step.
3. Prefer the official current PayPal implementation guide over guessed API method signatures. Use sandbox only.
4. Keep full type safety and input validation at integration boundaries. All money is integer cents on the application side.
5. Avoid unnecessary libraries/services and generic abstractions. Build the most direct path to the working demo.
6. If a feature is blocked by credentials or external sandbox setup, make progress on independent phases and clearly identify the blocker; do not simulate successful payment.
7. Maintain a small `README.md` from day one; update it as integrations become functional.
8. Treat the user, not the LLM, as payment authority. No autonomous capture without both app-level consent and PayPal buyer approval.
9. Do not represent EventsMate-native tickets as valid tickets for third-party event platforms.
10. Leave the repository ready for a real, repeatable hackathon demo.

---

**Definition of done:** A person types an event request, the AI asks a follow-up if necessary, calls real event-search tools, proposes affordable events, the person approves the exact purchase, PayPal sandbox processes a real checkout, and EventsMate persists and shows verified tickets with PayPal references. Everything else is secondary.
