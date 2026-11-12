-- F5 Agent matching (TODO item 9).
--
-- begin_settlement gains two things:
-- - p_reason: why this match was made. The agent's own sentence when the
--   allocation came from the model; the first-come wording otherwise.
-- - the fan's "all seats in the same ticket type" condition (D54), re-checked
--   here under the row locks.
-- Conditions are stored in the existing standby_requests.conditions column.

drop function begin_settlement(uuid, jsonb);

create function begin_settlement(p_request_id uuid, p_items jsonb, p_reason text default null)
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
  v_tier_id uuid;
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
    -- D54: the fan asked for all seats in one ticket type.
    if coalesce((v_request.conditions ->> 'same_tier')::boolean, false) then
      if v_tier_id is not null and v_tier_id <> v_ticket.tier_id then
        raise exception 'mixed_tiers';
      end if;
      v_tier_id := v_ticket.tier_id;
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
          coalesce(
            nullif(btrim(p_reason), ''),
            format('Matched %s released seat%s to the oldest standby request they fill completely.',
                   v_request.quantity, case when v_request.quantity = 1 then '' else 's' end)),
          v_total);
  return v_total;
end;
$$;

revoke all on function begin_settlement(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function begin_settlement(uuid, jsonb, text) to service_role;
notify pgrst, 'reload schema';
