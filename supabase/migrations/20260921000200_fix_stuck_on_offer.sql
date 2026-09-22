-- ============================================================================
-- 0021  Fix: a rider with a merely-offered (never accepted) assignment stayed
--       stuck at 'on_offer' forever if the order was cancelled or failed
--       before they answered.
-- ----------------------------------------------------------------------------
-- advance_order's cancel/fail branch only ever reset the rider found by
-- current_rider_for_order(), which recognises only an 'accepted' assignment
-- (0006). The delivery_assignments row for an unanswered 'offered' one was
-- still correctly flipped to 'cancelled' two lines above it, but nothing
-- ever told that rider's own row to leave 'on_offer' - dispatch_candidates
-- (0010) requires status = 'online_idle', so they silently stopped receiving
-- any job at all until someone noticed and fixed the row by hand.
--
-- Found by hand today: Carlo Mendoza's status had been stuck at 'on_offer'
-- since a cancelled assignment from 2026-09-20T05:20, invisible to dispatch
-- the entire time.
-- ============================================================================

create or replace function public.advance_order(
  p_order_id uuid,
  p_to       public.order_status,
  p_note     text default null,
  p_pod_code text default null
)
returns public.orders
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_rider uuid;
  v_is_merchant boolean;
  v_is_rider    boolean;
  v_is_customer boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  -- Resolved once, up front: cancelling the assignment below would otherwise
  -- erase the answer before we have used it to free the rider.
  v_rider       := public.current_rider_for_order(p_order_id);
  v_is_merchant := public.is_merchant_member(v_order.merchant_id);
  v_is_rider    := v_rider is not null and v_rider = auth.uid();
  v_is_customer := v_order.customer_id = auth.uid();

  if not public.is_admin() then
    case p_to
      when 'accepted', 'preparing', 'ready_for_pickup' then
        if not v_is_merchant then
          raise exception 'only the store can move an order to %', p_to using errcode = '42501';
        end if;

      when 'picked_up', 'arrived' then
        if not v_is_rider then
          raise exception 'only the assigned rider can move an order to %', p_to using errcode = '42501';
        end if;

      when 'delivered' then
        -- Pickup orders are completed by the store; deliveries by the rider.
        if v_order.type = 'pickup' then
          if not v_is_merchant then
            raise exception 'only the store can complete a pickup order' using errcode = '42501';
          end if;
        elsif not v_is_rider then
          raise exception 'only the assigned rider can complete a delivery' using errcode = '42501';
        end if;

        -- Dormant since place_order (above) stopped generating a code:
        -- v_order.pod_code is null for every new order, so this never fires
        -- for them. Left in rather than removed - an order still carrying an
        -- old code (placed before the change) keeps being checked correctly
        -- if a client ever sends one, and the check costs nothing to keep.
        if v_order.pod_code is not null and p_pod_code is not null
           and p_pod_code <> v_order.pod_code then
          raise exception 'incorrect delivery code' using errcode = 'P0001';
        end if;

      when 'cancelled' then
        if v_is_customer then
          -- The customer's window closes the moment the kitchen commits.
          if v_order.status not in ('draft', 'pending_payment', 'placed') then
            raise exception 'this order can no longer be cancelled - the store has started preparing it'
              using errcode = 'P0001';
          end if;
        elsif not v_is_merchant then
          raise exception 'not_authorised_to_cancel' using errcode = '42501';
        end if;

      when 'failed' then
        if not v_is_rider then
          raise exception 'only the assigned rider can mark a delivery failed' using errcode = '42501';
        end if;

      else
        raise exception 'not_authorised' using errcode = '42501';
    end case;
  end if;

  update public.orders
  set status = p_to,
      cancellation_reason = case when p_to = 'cancelled' then coalesce(p_note, cancellation_reason) else cancellation_reason end,
      failure_reason      = case when p_to = 'failed'    then coalesce(p_note, failure_reason)      else failure_reason end,
      cancelled_by        = case when p_to = 'cancelled' then auth.uid() else cancelled_by end
  where id = p_order_id
  returning * into v_order;

  -- Settlement is a consequence of delivery, not a separate button someone
  -- might forget to press.
  if p_to = 'delivered' then
    update public.delivery_assignments
    set status = 'completed', completed_at = now()
    where order_id = p_order_id and status = 'accepted';

    perform public.settle_order(p_order_id);
  end if;

  if p_to in ('cancelled', 'failed') then
    -- Close any live offer or acceptance, then hand every rider it touched
    -- back to the pool - not just current_rider_for_order's answer, which
    -- only recognises 'accepted'. A rider whose offer was still unanswered
    -- gets freed here too, with no strike against them since they never
    -- committed to anything.
    with closed as (
      update public.delivery_assignments
      set status = 'cancelled', responded_at = now()
      where order_id = p_order_id and status in ('offered', 'accepted')
      returning rider_id
    )
    update public.riders r
    set status = 'online_idle'
    from closed c
    where r.id = c.rider_id and r.status <> 'offline';

    -- The cancelled_deliveries strike stays scoped to a rider who had
    -- actually accepted - v_rider, same as before this fix.
    if v_rider is not null and p_to = 'failed' then
      update public.riders
      set cancelled_deliveries = cancelled_deliveries + 1
      where id = v_rider;
    end if;
  end if;

  return v_order;
end;
$$;
