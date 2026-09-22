-- ============================================================================
-- 0018  Suspend/reactivate: two states nothing could ever reach.
-- ----------------------------------------------------------------------------
-- merchants.status has allowed 'suspended' since 0003, and riders.is_suspended
-- has been read by set_rider_availability, dispatch_candidates and
-- offer_order_to_rider (0008/0010) from the start - is_merchant_open() already
-- refuses a suspended store and dispatch already skips a suspended rider. But
-- nothing has ever written either value: there was no suspend_merchant,
-- suspend_rider, or a way back. Enforcement was already correct; only the
-- switch was missing.
-- ============================================================================

create or replace function public.suspend_merchant(p_merchant_id uuid, p_reason text)
returns public.merchants
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_merchant public.merchants;
  v_reason   text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Say why the store is being suspended.' using errcode = 'P0001';
  end if;

  select * into v_merchant from public.merchants where id = p_merchant_id for update;
  if v_merchant.id is null then
    raise exception 'That store no longer exists.' using errcode = 'P0002';
  end if;
  if v_merchant.status <> 'approved' then
    raise exception 'Only a live store can be suspended.' using errcode = 'P0001';
  end if;

  -- rejection_reason is reused here rather than adding a parallel column:
  -- both states are "why this store cannot take orders right now", read by
  -- the same spot on the merchant's own settings page.
  update public.merchants
  set status = 'suspended', rejection_reason = v_reason
  where id = p_merchant_id
  returning * into v_merchant;

  insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, after, note)
  values (auth.uid(), 'suspend_merchant', 'merchants', p_merchant_id::text, jsonb_build_object('status', 'suspended'), v_reason);

  return v_merchant;
end;
$$;

-- Held to the same bar as approve_merchant (0016/0017): if a required permit
-- lapsed while the store sat suspended, reactivating should not wave that
-- through.
create or replace function public.reactivate_merchant(p_merchant_id uuid)
returns public.merchants
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_merchant public.merchants;
  v_missing  text[];
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_merchant from public.merchants where id = p_merchant_id for update;
  if v_merchant.id is null then
    raise exception 'That store no longer exists.' using errcode = 'P0002';
  end if;
  if v_merchant.status <> 'suspended' then
    raise exception 'This store is not suspended.' using errcode = 'P0001';
  end if;

  select array(
    select d
    from unnest(public.merchant_required_documents()) as d
    where not exists (
      select 1 from public.merchant_documents x
      where x.merchant_id = p_merchant_id
        and x.doc_type = d
        and x.status = 'approved'
        and (x.expires_at is null or x.expires_at >= current_date)
    )
  ) into v_missing;

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception 'Still missing approved documents: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;

  update public.merchants
  set status = 'approved', rejection_reason = null
  where id = p_merchant_id
  returning * into v_merchant;

  insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'reactivate_merchant', 'merchants', p_merchant_id::text, jsonb_build_object('status', 'approved'));

  return v_merchant;
end;
$$;

create or replace function public.suspend_rider(p_rider_id uuid, p_reason text)
returns public.riders
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rider  public.riders;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Say why the rider is being suspended.' using errcode = 'P0001';
  end if;

  select * into v_rider from public.riders where id = p_rider_id for update;
  if v_rider.id is null then
    raise exception 'That rider no longer exists.' using errcode = 'P0002';
  end if;
  if v_rider.is_suspended then
    raise exception 'This rider is already suspended.' using errcode = 'P0001';
  end if;

  -- Idle riders are pulled offline immediately - set_rider_availability
  -- already refuses to let them go back online while suspended. A rider
  -- mid-delivery is left alone: dispatch (0008/0010) will not offer them
  -- another job, but yanking them off an active order strands whoever is
  -- waiting on it, which is worse than letting this one finish.
  update public.riders
  set is_suspended = true,
      status = case when status = 'online_idle' then 'offline' else status end
  where id = p_rider_id
  returning * into v_rider;

  insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, after, note)
  values (auth.uid(), 'suspend_rider', 'riders', p_rider_id::text, jsonb_build_object('is_suspended', true), v_reason);

  return v_rider;
end;
$$;

create or replace function public.unsuspend_rider(p_rider_id uuid)
returns public.riders
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rider public.riders;
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_rider from public.riders where id = p_rider_id for update;
  if v_rider.id is null then
    raise exception 'That rider no longer exists.' using errcode = 'P0002';
  end if;
  if not v_rider.is_suspended then
    raise exception 'This rider is not suspended.' using errcode = 'P0001';
  end if;

  update public.riders
  set is_suspended = false
  where id = p_rider_id
  returning * into v_rider;

  insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'unsuspend_rider', 'riders', p_rider_id::text, jsonb_build_object('is_suspended', false));

  return v_rider;
end;
$$;

revoke execute on function public.suspend_merchant(uuid, text) from anon;
revoke execute on function public.reactivate_merchant(uuid) from anon;
revoke execute on function public.suspend_rider(uuid, text) from anon;
revoke execute on function public.unsuspend_rider(uuid) from anon;
grant execute on function public.suspend_merchant(uuid, text) to authenticated;
grant execute on function public.reactivate_merchant(uuid) to authenticated;
grant execute on function public.suspend_rider(uuid, text) to authenticated;
grant execute on function public.unsuspend_rider(uuid) to authenticated;
