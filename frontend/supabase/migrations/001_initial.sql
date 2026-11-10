-- EventsMate initial schema. Run once in the Supabase SQL editor (or `supabase db push`).

create extension if not exists pgcrypto;

create table if not exists events (
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

create index if not exists events_starts_at_idx on events (starts_at);
create index if not exists events_tags_idx on events using gin (tags);

create table if not exists agent_sessions (
  id uuid primary key default gen_random_uuid(),
  constraints jsonb not null default '{}',
  messages jsonb not null default '[]',
  created_at timestamptz default now()
);

create table if not exists checkouts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references agent_sessions(id),
  -- { items: [{ eventId, title, quantity, unitPriceCents }], maxBudgetCents? }
  approved_snapshot jsonb not null,
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'CAD',
  status text not null default 'prepared'
    check (status in ('prepared','approved','paypal_created','paid','cancelled','failed')),
  paypal_order_id text unique,
  paypal_capture_id text unique,
  created_at timestamptz default now(),
  approved_at timestamptz
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null references checkouts(id),
  event_id uuid not null references events(id),
  ticket_number text not null unique,
  created_at timestamptz default now(),
  unique (checkout_id, event_id, ticket_number)
);

create index if not exists tickets_checkout_idx on tickets (checkout_id);

-- All access goes through Next.js Route Handlers using the service role key,
-- which bypasses RLS. Enabling RLS with no policies blocks the anon/public keys.
alter table events enable row level security;
alter table agent_sessions enable row level security;
alter table checkouts enable row level security;
alter table tickets enable row level security;

-- Called by the server only AFTER PayPal reports a COMPLETED capture.
-- One transaction: lock the checkout and its event rows, verify capacity,
-- increment sold_count, mark the checkout paid, insert one ticket per attendee.
-- Idempotent: a repeat call for an already-paid checkout changes nothing.
-- Returns 'paid', 'already_paid', or raises (checkout stays unpaid for
-- manual reconciliation; the caller must not show success).
create or replace function fulfill_checkout(p_checkout_id uuid, p_capture_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkout checkouts%rowtype;
  v_item jsonb;
  v_event events%rowtype;
  v_qty integer;
  v_n integer;
begin
  select * into v_checkout from checkouts where id = p_checkout_id for update;
  if not found then
    raise exception 'checkout_not_found';
  end if;

  if v_checkout.status = 'paid' then
    return 'already_paid';
  end if;

  if v_checkout.status <> 'paypal_created' then
    raise exception 'checkout_not_payable: %', v_checkout.status;
  end if;

  for v_item in
    select value from jsonb_array_elements(v_checkout.approved_snapshot -> 'items')
    order by value ->> 'eventId'  -- stable lock order
  loop
    v_qty := (v_item ->> 'quantity')::integer;

    select * into v_event from events
      where id = (v_item ->> 'eventId')::uuid for update;
    if not found or v_event.status <> 'published' then
      raise exception 'event_unavailable: %', v_item ->> 'eventId';
    end if;
    if v_event.sold_count + v_qty > v_event.capacity then
      raise exception 'insufficient_inventory: %', v_item ->> 'eventId';
    end if;

    update events set sold_count = sold_count + v_qty where id = v_event.id;

    for v_n in 1..v_qty loop
      insert into tickets (checkout_id, event_id, ticket_number)
      values (
        p_checkout_id,
        v_event.id,
        'EM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
      );
    end loop;
  end loop;

  update checkouts
    set status = 'paid', paypal_capture_id = p_capture_id
    where id = p_checkout_id;

  return 'paid';
end;
$$;

revoke all on function fulfill_checkout(uuid, text) from public, anon, authenticated;
grant execute on function fulfill_checkout(uuid, text) to service_role;
