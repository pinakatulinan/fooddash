-- ============================================================================
-- 0012  Fix: anonymous callers could bypass dispatch_candidates /
--        offer_order_to_rider's ops-only check
-- ----------------------------------------------------------------------------
-- Both functions gated themselves with `is_admin() or auth.uid() is null`,
-- intending that null branch to cover only pg_cron's raw session (which has
-- no PostgREST-issued JWT at all). But auth.uid() is *also* null for a
-- perfectly normal PostgREST request made with nothing but the public anon
-- key and no signed-in session - the anon key's JWT carries a "role" claim
-- and no "sub" claim, so auth.uid() (-> claims->>'sub') is null there too.
-- The two cases were never actually distinguishable by auth.uid() alone.
--
-- Net effect: any unauthenticated caller holding only the public anon key
-- could call dispatch_candidates() to read any rider's full name and live
-- cash-on-hand for any order id, and could call offer_order_to_rider() to
-- assign any rider to any order - the exact class of bug both functions'
-- doc comments already describe having fixed once, from a different angle.
--
-- The real distinguishing signal is whether PostgREST set a JWT context at
-- all: pg_cron's session never has the `request.jwt.claims` GUC set, while
-- every PostgREST call does (even anon, even with nobody signed in).
-- ----------------------------------------------------------------------------

create or replace function public.is_internal_session()
returns boolean
language sql
stable
as $$
  select current_setting('request.jwt.claims', true) is null;
$$;

create or replace function public.dispatch_candidates(
  p_order_id uuid,
  p_limit    integer default 5
)
returns table (rider_id uuid, distance_m integer, full_name text, cash_on_hand_centavos integer)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_order    public.orders;
  v_merchant public.merchants;
  v_radius   integer := (public.setting('dispatch_search_radius_m'))::text::integer;
  v_cash_cap integer := (public.setting('rider_cash_cap_centavos'))::text::integer;
begin
  if not (public.is_admin() or public.is_internal_session()) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  select * into v_merchant from public.merchants where id = v_order.merchant_id;

  return query
  select r.id,
         ceil(extensions.st_distance(r.current_location, v_merchant.location))::integer,
         p.full_name,
         r.cash_on_hand_centavos
  from public.riders r
  join public.profiles p on p.id = r.id
  where r.is_verified
    and not r.is_suspended
    and r.status = 'online_idle'
    and r.current_location is not null
    and r.last_ping_at > now() - interval '2 minutes'
    and extensions.st_dwithin(r.current_location, v_merchant.location, v_radius)
    and (v_order.payment_method <> 'cod'
         or r.cash_on_hand_centavos + v_order.total_centavos <= v_cash_cap)
    and not exists (
      select 1 from public.delivery_assignments a
      where a.order_id = p_order_id and a.rider_id = r.id
        and a.status in ('declined', 'expired')
    )
  order by r.current_location <-> v_merchant.location
  limit greatest(p_limit, 1);
end;
$$;

create or replace function public.offer_order_to_rider(
  p_order_id uuid,
  p_rider_id uuid,
  p_is_auto  boolean default false
)
returns public.delivery_assignments
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_order      public.orders;
  v_merchant   public.merchants;
  v_assignment public.delivery_assignments;
  v_seconds    integer := (public.setting('dispatch_offer_seconds'))::text::integer;
begin
  if not (public.is_admin() or public.is_internal_session()) then
    raise exception 'only ops may assign riders' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.status not in ('placed', 'accepted', 'preparing', 'ready_for_pickup') then
    raise exception 'order % is not dispatchable (status %)', v_order.code, v_order.status
      using errcode = 'P0001';
  end if;

  select * into v_merchant from public.merchants where id = v_order.merchant_id;

  -- Self-heal this order's own stale offer before checking for a live one.
  -- expire_stale_offers() is meant to sweep these on a schedule, but a rider
  -- offer that timed out thirty seconds ago and simply has not been swept yet
  -- is not "live" - it should not be able to block ops from re-dispatching,
  -- the same way respond_to_assignment already treats a stale offer as
  -- expired the moment anyone tries to act on it.
  with expired as (
    update public.delivery_assignments
    set status = 'expired', responded_at = now()
    where order_id = p_order_id and status = 'offered' and expires_at < now()
    returning rider_id
  )
  update public.riders r
  set status = 'online_idle'
  from expired e
  where r.id = e.rider_id and r.status = 'on_offer';

  -- The partial unique index does the real enforcement; this is the friendly
  -- error rather than a constraint violation surfacing to an ops user.
  if exists (
    select 1 from public.delivery_assignments
    where order_id = p_order_id and status in ('offered', 'accepted')
  ) then
    raise exception 'order % already has a live rider offer', v_order.code using errcode = 'P0001';
  end if;

  insert into public.delivery_assignments (
    order_id, rider_id, status, assigned_by, is_auto,
    distance_to_store_m, payout_centavos, expires_at
  ) values (
    p_order_id, p_rider_id, 'offered', auth.uid(), p_is_auto,
    ceil(extensions.st_distance(
      (select current_location from public.riders where id = p_rider_id),
      v_merchant.location
    ))::integer,
    v_order.rider_earning_centavos + v_order.tip_centavos,
    now() + make_interval(secs => v_seconds)
  )
  returning * into v_assignment;

  update public.riders set status = 'on_offer' where id = p_rider_id and status = 'online_idle';

  return v_assignment;
end;
$$;
