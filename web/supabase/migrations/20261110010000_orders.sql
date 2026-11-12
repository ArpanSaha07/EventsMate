-- F2 Buy a ticket: issue tickets for a paid order.
--
-- Called by the server only AFTER PayPal reports a COMPLETED capture whose
-- amount, currency and custom id match the order.
-- One transaction: lock the order and its tiers, verify capacity, increment
-- sold_count, insert one ticket per seat, mark the order paid.
-- Idempotent: a repeat call for a paid order changes nothing.
-- Returns 'paid' or 'already_paid'; raises otherwise (nothing is written).

create or replace function fulfil_order(p_order_id uuid, p_capture_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_item jsonb;
  v_tier ticket_tiers%rowtype;
  v_qty integer;
  v_n integer;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;

  if v_order.status = 'paid' then
    return 'already_paid';
  end if;

  if v_order.status <> 'created' then
    raise exception 'order_not_payable: %', v_order.status;
  end if;

  for v_item in
    select value from jsonb_array_elements(v_order.items)
    order by value ->> 'tierId'  -- stable lock order
  loop
    v_qty := (v_item ->> 'quantity')::integer;

    select * into v_tier from ticket_tiers
      where id = (v_item ->> 'tierId')::uuid for update;
    if not found or v_tier.event_id <> v_order.event_id then
      raise exception 'tier_unavailable: %', v_item ->> 'tierId';
    end if;
    if v_tier.sold_count + v_qty > v_tier.capacity then
      raise exception 'insufficient_inventory: %', v_tier.name;
    end if;

    update ticket_tiers set sold_count = sold_count + v_qty where id = v_tier.id;

    for v_n in 1..v_qty loop
      insert into tickets
        (event_id, tier_id, owner_id, order_id, ticket_number, unit_price_cents, source_capture_id)
      values (
        v_order.event_id,
        v_tier.id,
        v_order.buyer_id,
        v_order.id,
        'EM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
        (v_item ->> 'unitPriceCents')::integer,
        p_capture_id
      );
    end loop;
  end loop;

  update orders
    set status = 'paid', paypal_capture_id = p_capture_id, paid_at = now()
    where id = v_order.id;

  return 'paid';
end;
$$;

revoke all on function fulfil_order(uuid, text) from public, anon, authenticated;
grant execute on function fulfil_order(uuid, text) to service_role;
