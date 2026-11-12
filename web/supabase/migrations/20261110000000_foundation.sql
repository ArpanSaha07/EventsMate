-- EventsMate foundation schema: people, events, tiers, orders, tickets.
-- Later features add their own migrations (standby, settlements, action log, webhooks).
-- All access goes through Next.js Route Handlers with the service-role key.

create extension if not exists pgcrypto;

-- Seeded demo people. `switchable` ones appear in the persona switcher;
-- the rest only own seeded filler tickets.
create table profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  role text not null check (role in ('attendee', 'organiser')),
  blurb text not null default '',
  switchable boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references profiles (id),
  title text not null,
  description text not null default '',
  category text not null,
  venue text not null,
  city text not null,
  timezone text not null default 'America/Los_Angeles',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'published' check (status in ('published', 'cancelled')),
  -- Plain-language policy written by the organiser. The structured rule is
  -- extracted by the policy reader (F6) and confirmed by the organiser.
  refund_policy_text text not null default '',
  refund_rule jsonb,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index events_starts_at_idx on events (starts_at);

create table ticket_tiers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  name text not null,
  description text not null default '',
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'USD' check (currency = 'USD'),
  capacity integer not null check (capacity >= 0),
  sold_count integer not null default 0 check (sold_count >= 0),
  sort_order integer not null default 0,
  unique (event_id, name),
  check (sold_count <= capacity)
);

create index ticket_tiers_event_idx on ticket_tiers (event_id);

-- A primary purchase: one PayPal order, captured immediately.
create table orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references profiles (id),
  event_id uuid not null references events (id),
  -- Server-computed snapshot: [{ tierId, tierName, quantity, unitPriceCents }]
  items jsonb not null,
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'created'
    check (status in ('created', 'paid', 'cancelled', 'failed', 'needs_reconciliation')),
  paypal_order_id text unique,
  paypal_capture_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index orders_buyer_idx on orders (buyer_id);

-- One seat. `source_capture_id` is the PayPal capture that paid for it and is
-- what a resale refund is issued against; seeded filler tickets have none and
-- therefore can never be released.
create table tickets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id),
  tier_id uuid not null references ticket_tiers (id),
  owner_id uuid not null references profiles (id),
  order_id uuid references orders (id),
  ticket_number text not null unique,
  status text not null default 'valid' check (status in ('valid', 'released', 'transferred')),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  source_capture_id text,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

create index tickets_owner_idx on tickets (owner_id);
create index tickets_tier_status_idx on tickets (tier_id, status);

-- RLS on with no policies: the anon and authenticated keys can read nothing.
alter table profiles enable row level security;
alter table events enable row level security;
alter table ticket_tiers enable row level security;
alter table orders enable row level security;
alter table tickets enable row level security;
