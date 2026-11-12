-- F5 Settlement: resell a released seat to a fan on standby.
--
-- Order per match (D10, D52): capture the fan's hold, refund the holder, then
-- transfer the ticket. One PayPal capture per standby request (D50: a request
-- is filled completely or not at all); one settlement row per ticket.
-- Every ticket and request state change happens inside a function below.

alter table standby_requests add column capture_id text unique;
alter table standby_requests add column captured_cents integer check (captured_cents > 0);

-- One resale of one ticket.
-- pending: claimed, capture not confirmed.  captured: fan charged, holder not yet refunded.
-- refund_failed: fan charged, refund refused; retried on the next matching run.
-- refunded: refund done at PayPal, transfer not yet written (reconciliation).
-- transferred: done.  capture_failed: nobody charged, nobody refunded, seat still released.
create table settlements (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id),
  request_id uuid not null references standby_requests (id),
  event_id uuid not null references events (id),
  holder_id uuid not null references profiles (id),
  fan_id uuid not null references profiles (id),
  -- What the fan pays for this seat: the tier's face price (D28).
  price_cents integer not null check (price_cents > 0),
  -- What the holder gets back, computed at resale from the rule copied at release (D35, D36).
  refund_cents integer not null check (refund_cents > 0),
  refund_terms text not null,
  refund_quote text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'captured', 'refund_failed', 'refunded', 'transferred', 'capture_failed')),
  capture_id text,
  refund_id text unique,
  new_ticket_id uuid references tickets (id),
  failure_reason text,
  created_at timestamptz not null default now(),
  captured_at timestamptz,
  refunded_at timestamptz,
  completed_at timestamptz
);

-- A seat can be in at most one settlement that has not failed: it is never sold twice.
create unique index settlements_one_live_per_ticket_idx on settlements (ticket_id)
  where status <> 'capture_failed';
create index settlements_request_idx on settlements (request_id);
create index settlements_event_idx on settlements (event_id);

-- The action log: every agent decision and money movement, with its PayPal reference.
create table agent_actions (
  id uuid primary key default gen_random_uuid(),
  actor text not null default 'agent',
  kind text not null
    check (kind in ('match', 'capture', 'capture_failed', 'refund', 'refund_failed', 'transfer')),
  event_id uuid references events (id),
  request_id uuid references standby_requests (id),
  ticket_id uuid references tickets (id),
  settlement_id uuid references settlements (id),
  reason text not null,
  paypal_ref text,
  amount_cents integer,
  created_at timestamptz not null default now()
);

create index agent_actions_event_idx on agent_actions (event_id, created_at);

alter table settlements enable row level security;
alter table agent_actions enable row level security;

-- Step 1. Claim released tickets for one standby request. All or nothing.
-- p_items: [{ "ticket_id", "refund_cents", "refund_terms", "refund_quote" }], one per seat.
-- Re-checks everything under row locks; raises if anything is no longer eligible.
-- Returns the amount to capture: the sum of the tiers' face prices.
create or replace function begin_settlement(p_request_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request standby_requests%rowtype;
  v_event events%rowtype;
  v_ticket tickets%rowtype;
  v_item jsonb;
  v_price integer;
  v_refund integer;
  v_total integer := 0;
begin
  select * into v_request from standby_requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if v_request.status <> 'authorized' or v_request.authorization_id is null then
    raise exception 'request_not_eligible: %', v_request.status;
  end if;

  select * into v_event from events where id = v_request.event_id for share;
  if v_event.status <> 'published' or now() >= v_event.starts_at - interval '2 hours' then
    raise exception 'matching_closed';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) <> v_request.quantity then
    raise exception 'quantity_mismatch';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items) order by value ->> 'ticket_id'
  loop
    select * into v_ticket from tickets where id = (v_item ->> 'ticket_id')::uuid for update;
    if not found or v_ticket.status <> 'released' or v_ticket.event_id <> v_request.event_id
       or v_ticket.source_capture_id is null then
      raise exception 'ticket_not_eligible';
    end if;
    -- A holder's own released seat is never matched to their own request.
    if v_ticket.owner_id = v_request.fan_id then
      raise exception 'own_ticket';
    end if;
    if not (v_ticket.tier_id = any (v_request.accepted_tier_ids)) then
      raise exception 'tier_not_accepted';
    end if;
    if exists (select 1 from settlements where ticket_id = v_ticket.id and status <> 'capture_failed') then
      raise exception 'ticket_in_settlement';
    end if;

    select price_cents into v_price from ticket_tiers where id = v_ticket.tier_id;
    v_refund := (v_item ->> 'refund_cents')::integer;
    -- The refund is issued against the holder's own payment, so it can never exceed it.
    if v_refund is null or v_refund <= 0 or v_refund > v_ticket.unit_price_cents then
      raise exception 'invalid_refund';
    end if;

    insert into settlements
      (ticket_id, request_id, event_id, holder_id, fan_id, price_cents, refund_cents, refund_terms, refund_quote)
    values
      (v_ticket.id, v_request.id, v_request.event_id, v_ticket.owner_id, v_request.fan_id, v_price, v_refund,
       coalesce(v_item ->> 'refund_terms', ''), coalesce(v_item ->> 'refund_quote', ''));
    v_total := v_total + v_price;
  end loop;

  -- Never capture more than the fan approved.
  if v_total <= 0 or v_total > v_request.authorized_cents then
    raise exception 'exceeds_hold';
  end if;

  update standby_requests set status = 'matched' where id = v_request.id;

  insert into agent_actions (kind, event_id, request_id, reason, amount_cents)
  values ('match', v_request.event_id, v_request.id,
          format('Matched %s released seat%s to the oldest standby request they fill completely.',
                 v_request.quantity, case when v_request.quantity = 1 then '' else 's' end),
          v_total);
  return v_total;
end;
$$;

-- Step 2a. PayPal reported a COMPLETED capture of the fan's hold.
-- Returns 'captured' or 'already_captured'.
create or replace function record_settlement_capture(p_request_id uuid, p_capture_id text, p_amount_cents integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request standby_requests%rowtype;
  v_total integer;
begin
  select * into v_request from standby_requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if v_request.capture_id = p_capture_id then
    return 'already_captured';
  end if;
  if v_request.status <> 'matched' or v_request.capture_id is not null then
    raise exception 'request_not_matched: %', v_request.status;
  end if;

  select coalesce(sum(price_cents), 0) into v_total
    from settlements where request_id = v_request.id and status = 'pending';
  if v_total <= 0 or v_total <> p_amount_cents then
    raise exception 'amount_mismatch';
  end if;

  update settlements
    set status = 'captured', capture_id = p_capture_id, captured_at = now()
    where request_id = v_request.id and status = 'pending';
  update standby_requests
    set capture_id = p_capture_id, captured_cents = p_amount_cents
    where id = v_request.id;

  insert into agent_actions (kind, event_id, request_id, reason, paypal_ref, amount_cents)
  values ('capture', v_request.event_id, v_request.id,
          'Captured the fan''s hold for the matched seats. The rest of the hold is released.',
          p_capture_id, p_amount_cents);
  return 'captured';
end;
$$;

-- Step 2b. PayPal refused the capture. Nobody is charged or refunded; the
-- tickets stay released for the next request. Returns 'failed' or 'already_failed'.
create or replace function fail_settlement_capture(p_request_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request standby_requests%rowtype;
begin
  select * into v_request from standby_requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if v_request.status = 'failed' then
    return 'already_failed';
  end if;
  if v_request.status <> 'matched' or v_request.capture_id is not null then
    raise exception 'request_not_matched: %', v_request.status;
  end if;

  update settlements
    set status = 'capture_failed', failure_reason = p_reason, completed_at = now()
    where request_id = v_request.id and status = 'pending';
  update standby_requests set status = 'failed', closed_at = now() where id = v_request.id;

  insert into agent_actions (kind, event_id, request_id, reason)
  values ('capture_failed', v_request.event_id, v_request.id,
          'PayPal did not capture the hold (' || p_reason
          || '). Nobody was charged or refunded; the seats stay released for the next request.');
  return 'failed';
end;
$$;

-- Step 3 failed: the fan is charged but PayPal refused the holder's refund.
-- The ticket is NOT transferred (D52); the refund is retried on the next run.
create or replace function record_settlement_refund_failure(p_settlement_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement settlements%rowtype;
begin
  select * into v_settlement from settlements where id = p_settlement_id for update;
  if not found then
    raise exception 'settlement_not_found';
  end if;
  if v_settlement.status = 'refund_failed' then
    update settlements set failure_reason = p_reason where id = v_settlement.id;
    return 'already_failed';
  end if;
  if v_settlement.status <> 'captured' then
    raise exception 'settlement_not_captured: %', v_settlement.status;
  end if;

  update settlements set status = 'refund_failed', failure_reason = p_reason where id = v_settlement.id;
  insert into agent_actions (kind, event_id, request_id, ticket_id, settlement_id, reason, amount_cents)
  values ('refund_failed', v_settlement.event_id, v_settlement.request_id, v_settlement.ticket_id, v_settlement.id,
          'PayPal did not complete the holder''s refund (' || p_reason
          || '). The ticket is not transferred until the refund succeeds; it will be retried.',
          v_settlement.refund_cents);
  return 'failed';
end;
$$;

-- Steps 3 and 4. PayPal reported a COMPLETED refund to the holder: record it,
-- mark the holder's ticket transferred and issue the fan's ticket, in one
-- transaction. Returns 'transferred' or 'already_transferred'.
create or replace function complete_settlement(p_settlement_id uuid, p_refund_id text, p_refund_cents integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement settlements%rowtype;
  v_ticket tickets%rowtype;
  v_new_id uuid;
begin
  select * into v_settlement from settlements where id = p_settlement_id for update;
  if not found then
    raise exception 'settlement_not_found';
  end if;
  if v_settlement.status = 'transferred' then
    return 'already_transferred';
  end if;
  if v_settlement.status not in ('captured', 'refund_failed', 'refunded') or v_settlement.capture_id is null then
    raise exception 'settlement_not_captured: %', v_settlement.status;
  end if;
  if p_refund_id is null or p_refund_cents is distinct from v_settlement.refund_cents then
    raise exception 'refund_mismatch';
  end if;

  select * into v_ticket from tickets where id = v_settlement.ticket_id for update;
  if v_ticket.status <> 'released' or v_ticket.owner_id <> v_settlement.holder_id then
    raise exception 'ticket_not_eligible';
  end if;

  update tickets
    set status = 'transferred', released_at = null, release_rule = null
    where id = v_ticket.id;

  -- The fan's ticket is backed by the fan's own capture, so they can release it later.
  insert into tickets (event_id, tier_id, owner_id, ticket_number, unit_price_cents, source_capture_id)
  values (v_ticket.event_id, v_ticket.tier_id, v_settlement.fan_id,
          'EM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
          v_settlement.price_cents, v_settlement.capture_id)
  returning id into v_new_id;

  update settlements
    set status = 'transferred', refund_id = p_refund_id, refunded_at = coalesce(refunded_at, now()),
        completed_at = now(), new_ticket_id = v_new_id, failure_reason = null
    where id = v_settlement.id;

  insert into agent_actions (kind, event_id, request_id, ticket_id, settlement_id, reason, paypal_ref, amount_cents)
  values
    ('refund', v_settlement.event_id, v_settlement.request_id, v_ticket.id, v_settlement.id,
     'Refunded the holder under the event''s policy: ' || v_settlement.refund_terms || '.',
     p_refund_id, v_settlement.refund_cents),
    ('transfer', v_settlement.event_id, v_settlement.request_id, v_new_id, v_settlement.id,
     'Transferred the seat: ticket ' || v_ticket.ticket_number || ' ended and a new ticket was issued to the fan.',
     v_settlement.capture_id, v_settlement.price_cents);

  if not exists (
    select 1 from settlements
    where request_id = v_settlement.request_id and status not in ('transferred', 'capture_failed')
  ) then
    update standby_requests
      set status = 'settled', closed_at = now()
      where id = v_settlement.request_id and status = 'matched';
  end if;
  return 'transferred';
end;
$$;

-- A ticket with a settlement in progress can no longer be taken back.
create or replace function take_back_ticket(p_owner_id uuid, p_ticket_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket tickets%rowtype;
begin
  select * into v_ticket from tickets where id = p_ticket_id for update;
  if not found or v_ticket.owner_id <> p_owner_id then
    raise exception 'ticket_not_found';
  end if;
  if v_ticket.status = 'valid' then
    return 'already_valid';
  end if;
  if v_ticket.status <> 'released' then
    raise exception 'ticket_resold';
  end if;
  if exists (select 1 from settlements where ticket_id = v_ticket.id and status <> 'capture_failed') then
    raise exception 'ticket_in_settlement';
  end if;

  update tickets
    set status = 'valid', released_at = null, release_rule = null
    where id = v_ticket.id;
  return 'taken_back';
end;
$$;

-- D38, now skipping tickets with a settlement in progress.
create or replace function return_unmatched_tickets(p_owner_id uuid default null, p_event_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with due as (
    select t.id
    from tickets t
    join events e on e.id = t.event_id
    where t.status = 'released'
      and now() >= e.starts_at - interval '2 hours'
      and (p_owner_id is null or t.owner_id = p_owner_id)
      and (p_event_id is null or t.event_id = p_event_id)
      and not exists (
        select 1 from settlements s where s.ticket_id = t.id and s.status <> 'capture_failed'
      )
    order by t.id
    for update of t
  )
  update tickets
    set status = 'valid', released_at = null, release_rule = null, returned_at = now()
    from due
    where tickets.id = due.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function begin_settlement(uuid, jsonb) from public, anon, authenticated;
revoke all on function record_settlement_capture(uuid, text, integer) from public, anon, authenticated;
revoke all on function fail_settlement_capture(uuid, text) from public, anon, authenticated;
revoke all on function record_settlement_refund_failure(uuid, text) from public, anon, authenticated;
revoke all on function complete_settlement(uuid, text, integer) from public, anon, authenticated;
grant execute on function begin_settlement(uuid, jsonb) to service_role;
grant execute on function record_settlement_capture(uuid, text, integer) to service_role;
grant execute on function fail_settlement_capture(uuid, text) to service_role;
grant execute on function record_settlement_refund_failure(uuid, text) to service_role;
grant execute on function complete_settlement(uuid, text, integer) to service_role;
notify pgrst, 'reload schema';
