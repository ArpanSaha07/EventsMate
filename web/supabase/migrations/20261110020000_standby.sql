-- F3 Go on standby: a fan's request for seats at a sold-out event, backed by a
-- PayPal authorization (funds held, not charged).

create table standby_requests (
  id uuid primary key default gen_random_uuid(),
  fan_id uuid not null references profiles (id),
  event_id uuid not null references events (id),
  quantity integer not null check (quantity between 1 and 4),
  -- Tiers the fan accepts. All were sold out when the request was made.
  accepted_tier_ids uuid[] not null check (cardinality(accepted_tier_ids) >= 1),
  -- Optional wishes in the fan's own words; parsed for matching later.
  conditions_text text not null default '',
  conditions jsonb,
  -- draft: PayPal order created, not yet approved.  authorized: hold in place, in the queue.
  -- matched/settled: seats found.  cancelled/expired: hold voided.  failed: PayPal refused.
  status text not null default 'draft'
    check (status in ('draft', 'authorized', 'matched', 'settled', 'cancelled', 'expired', 'failed')),
  -- Worst case: quantity x the most expensive accepted tier.
  authorized_cents integer not null check (authorized_cents > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  paypal_order_id text unique,
  authorization_id text unique,
  authorized_at timestamptz,
  -- PayPal guarantees capture for 3 days; after that the hold must be reauthorized.
  honor_expires_at timestamptz,
  -- The event's release cutoff: the request ends and the hold is voided.
  expires_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create index standby_requests_fan_idx on standby_requests (fan_id);
-- The queue: oldest authorized request first.
create index standby_requests_queue_idx on standby_requests (event_id, authorized_at)
  where status = 'authorized';
-- One active request per fan per event (decision D30).
create unique index standby_requests_one_active_idx on standby_requests (fan_id, event_id)
  where status = 'authorized';

alter table standby_requests enable row level security;
