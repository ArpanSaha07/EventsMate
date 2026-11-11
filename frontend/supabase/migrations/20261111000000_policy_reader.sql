-- F6 Refund policy reader.
--
-- The organiser writes a policy; the model proposes a structured rule; server
-- code validates it and stores it here as a reading. Only a validated
-- ('proposed') reading can be confirmed, and confirming swaps the event's
-- public policy text and its rule together, so they can never disagree.

alter table events add column refund_rule_confirmed_at timestamptz;

create table policy_readings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  organiser_id uuid not null references profiles (id),
  policy_text text not null check (char_length(policy_text) between 1 and 1000),
  -- proposed: passed validation, awaiting the organiser.  rejected: failed validation.
  -- confirmed: the event's current rule.  superseded: replaced by a later reading.
  status text not null check (status in ('proposed', 'rejected', 'confirmed', 'superseded')),
  -- Validated rule (refund-rule.ts, version 1). Null when rejected.
  rule jsonb,
  -- What the model returned, before validation. Kept for the audit trail.
  model_output jsonb,
  problems jsonb not null default '[]'::jsonb,
  model text not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  check ((status = 'rejected') = (rule is null))
);

create index policy_readings_event_idx on policy_readings (event_id, created_at desc);
create unique index policy_readings_one_confirmed_idx on policy_readings (event_id)
  where status = 'confirmed';

alter table policy_readings enable row level security;

-- Confirm a proposed reading. One transaction: lock the event and the reading,
-- check ownership and state, publish text + rule, retire older readings.
-- Idempotent: confirming the already-confirmed reading returns 'already_confirmed'.
create or replace function confirm_policy_reading(p_reading_id uuid, p_organiser_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reading policy_readings%rowtype;
  v_event events%rowtype;
begin
  select * into v_reading from policy_readings where id = p_reading_id;
  if not found then
    raise exception 'reading_not_found';
  end if;

  -- Event first, then reading: one lock order for every caller.
  select * into v_event from events where id = v_reading.event_id for update;
  if not found or v_event.organiser_id <> p_organiser_id then
    raise exception 'reading_not_found';
  end if;

  select * into v_reading from policy_readings where id = p_reading_id for update;

  if v_reading.status = 'confirmed' then
    return 'already_confirmed';
  end if;
  if v_reading.status <> 'proposed' or v_reading.rule is null then
    raise exception 'reading_not_confirmable: %', v_reading.status;
  end if;

  update policy_readings
    set status = 'superseded'
    where event_id = v_event.id and id <> v_reading.id and status in ('proposed', 'confirmed');

  update policy_readings
    set status = 'confirmed', confirmed_at = now()
    where id = v_reading.id;

  update events
    set refund_policy_text = v_reading.policy_text,
        refund_rule = v_reading.rule,
        refund_rule_confirmed_at = now()
    where id = v_event.id;

  return 'confirmed';
end;
$$;

revoke all on function confirm_policy_reading(uuid, uuid) from public, anon, authenticated;
grant execute on function confirm_policy_reading(uuid, uuid) to service_role;
