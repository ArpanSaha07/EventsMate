-- F4 Release a seat.
--
-- A holder lists a ticket for resale. The ticket stays theirs ('released') until
-- the agent resells it; they can take it back; at the release cutoff (2 hours
-- before the start, decision D26) unmatched tickets return to 'valid'.
-- Every ticket state change happens inside one of the functions below.

-- D44: a resold seat always pays something. Remove "no refund" clauses from
-- rules stored before that decision.
update events
set refund_rule = jsonb_set(
      refund_rule, '{clauses}',
      (select coalesce(jsonb_agg(c), '[]'::jsonb)
         from jsonb_array_elements(refund_rule -> 'clauses') c
        where (c ->> 'percent')::integer > 0))
where refund_rule is not null
  and exists (select 1 from jsonb_array_elements(refund_rule -> 'clauses') c
               where (c ->> 'percent')::integer = 0);

update policy_readings
set rule = jsonb_set(
      rule, '{clauses}',
      (select coalesce(jsonb_agg(c), '[]'::jsonb)
         from jsonb_array_elements(rule -> 'clauses') c
        where (c ->> 'percent')::integer > 0))
where rule is not null
  and exists (select 1 from jsonb_array_elements(rule -> 'clauses') c
               where (c ->> 'percent')::integer = 0);

-- D36: the confirmed rule as it was when the seat was released. The refund at
-- resale is computed from this copy, not from the event's current rule.
alter table tickets add column release_rule jsonb;
-- Set when a released ticket came back at the cutoff without being resold.
alter table tickets add column returned_at timestamptz;
alter table tickets add constraint tickets_release_state_check
  check ((status = 'released') = (released_at is not null and release_rule is not null));

create index tickets_released_idx on tickets (event_id, released_at) where status = 'released';

-- Release one or more of the owner's tickets for one event. All or nothing.
-- Idempotent: tickets already released are left as they are (their rule copy
-- is not replaced). Returns how many were newly released.
create or replace function release_tickets(p_owner_id uuid, p_ticket_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket tickets%rowtype;
  v_event events%rowtype;
  v_seen integer := 0;
  v_released integer := 0;
begin
  if p_ticket_ids is null or cardinality(p_ticket_ids) = 0 then
    raise exception 'ticket_not_found';
  end if;

  for v_ticket in
    select * from tickets where id = any(p_ticket_ids) order by id for update
  loop
    v_seen := v_seen + 1;
    if v_ticket.owner_id <> p_owner_id then
      raise exception 'ticket_not_found';
    end if;

    if v_event.id is null then
      -- Share lock: the rule cannot change while we copy it.
      select * into v_event from events where id = v_ticket.event_id for share;
      if v_event.status <> 'published' then
        raise exception 'event_unavailable';
      end if;
      if now() >= v_event.starts_at - interval '2 hours' then
        raise exception 'release_closed';
      end if;
      if v_event.refund_rule is null then
        raise exception 'no_refund_rule';
      end if;
    elsif v_ticket.event_id <> v_event.id then
      raise exception 'mixed_events';
    end if;

    if v_ticket.status = 'released' then
      continue;
    end if;
    if v_ticket.status <> 'valid' then
      raise exception 'ticket_not_releasable: %', v_ticket.status;
    end if;
    -- Without a PayPal capture there is nothing to refund against.
    if v_ticket.source_capture_id is null then
      raise exception 'ticket_not_refundable';
    end if;

    update tickets
      set status = 'released', released_at = now(), release_rule = v_event.refund_rule, returned_at = null
      where id = v_ticket.id;
    v_released := v_released + 1;
  end loop;

  if v_seen <> (select count(distinct t) from unnest(p_ticket_ids) t) then
    raise exception 'ticket_not_found';
  end if;
  return v_released;
end;
$$;

-- The holder takes a released ticket back before it is resold.
-- Returns 'taken_back' or 'already_valid'; raises if it was resold.
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

  update tickets
    set status = 'valid', released_at = null, release_rule = null
    where id = v_ticket.id;
  return 'taken_back';
end;
$$;

-- D38: return every released ticket whose event has passed its release cutoff.
-- Called before tickets or released seats are read. Optional filters narrow
-- the sweep. Returns how many tickets came back.
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

revoke all on function release_tickets(uuid, uuid[]) from public, anon, authenticated;
revoke all on function take_back_ticket(uuid, uuid) from public, anon, authenticated;
revoke all on function return_unmatched_tickets(uuid, uuid) from public, anon, authenticated;
grant execute on function release_tickets(uuid, uuid[]) to service_role;
grant execute on function take_back_ticket(uuid, uuid) to service_role;
grant execute on function return_unmatched_tickets(uuid, uuid) to service_role;
