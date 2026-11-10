# EventsMate

An AI event concierge: describe what you want to attend, the agent searches a catalog of
EventsMate-native events, proposes an itinerary within your budget, and prepares a ticket
purchase that you approve and pay through PayPal.

Built for the PayPal AI Hackathon (November 2026).

**Honest scope:** payments run in the **PayPal sandbox only**. The catalog is a seeded set of
**fictional demo events**; tickets are EventsMate-native and are not valid for any third-party
platform. One merchant (EventsMate), one aggregated order; no payouts to organizers.

## Status

| Phase | State |
|---|---|
| A. Stack, schema, seed, `/api/events` | Code done; needs your Supabase project |
| B. PayPal checkout vertical slice | SDKs wired (`src/lib/paypal`, `PayPalCheckout`); routes not built yet |
| C. OpenAI agent | Not started |
| D. Product UI | Not started (home page shows integration status) |

## Stack

Next.js 16 (App Router, Route Handlers) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui ·
Zod · OpenAI Node SDK · Supabase Postgres · PayPal Orders v2 (`@paypal/paypal-server-sdk`) and
PayPal JS SDK v6 (`@paypal/react-paypal-js/sdk-v6`) · Vitest.

The app lives in `frontend/`. It is the whole product: there is no separate backend service.

## Local setup

Requires Node.js 22+ (developed on 24).

```bash
cd frontend
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000
```

The home page (and `GET /api/health`) shows a live check for each integration. Setup is
complete when all four pass.

### 1. Supabase

1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor**, paste and run `frontend/supabase/migrations/001_initial.sql`.
3. Paste and run `frontend/supabase/seed.sql` (12 demo events, Nov 13–21, 2026).
4. From **Project Settings → API**, copy into `.env.local`:
   - `SUPABASE_URL` — the project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — the `service_role` (or `sb_secret_…`) key. Server-only.

### 2. PayPal sandbox

1. Sign in at https://developer.paypal.com/dashboard with **Sandbox** selected.
2. **Apps & Credentials → Create App** (type: Merchant). Copy the Client ID and Secret:
   - `PAYPAL_CLIENT_ID` and `NEXT_PUBLIC_PAYPAL_CLIENT_ID` — the same Client ID
   - `PAYPAL_CLIENT_SECRET` — the Secret. Server-only.
3. **Testing Tools → Sandbox Accounts**: note the email and password of a **Personal**
   (buyer) account. You log in with it in the PayPal popup during the demo.
4. The seed uses CAD. If checkout later rejects the currency, enable CAD for the sandbox
   business account or create a Canadian sandbox business account.

### 3. OpenAI

Create a key at https://platform.openai.com/api-keys and set `OPENAI_API_KEY` and
`OPENAI_MODEL` (any current model that supports function calling and structured outputs).

### 4. Session secret

`SESSION_SECRET` signs the guest session cookie:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Scripts (run in `frontend/`)

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | Route type generation + `tsc` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |

## Notes

- Secrets live only in `frontend/.env.local`, which is git-ignored. Never prefix a secret
  with `NEXT_PUBLIC_`.
- All money is integer cents; `src/lib/money.ts` holds the only conversions.
- Tickets are issued by the `fulfill_checkout` Postgres function, in one transaction, only
  after the server has verified a COMPLETED PayPal capture.
- Next.js 16 runs with Cache Components enabled, which forbids `export const runtime` in
  route files. Route Handlers already default to the Node.js runtime.

## License

MIT — see [LICENSE](LICENSE).
