-- ============================================================================
-- 0025  Two functions missed by 0024's PUBLIC-grant sweep.
-- ----------------------------------------------------------------------------
-- Found during a security audit: 0024 (close_public_grant_gap) revoked the
-- implicit PUBLIC execute grant from every "cron-only"/"admin-only" function
-- it could find by searching for existing role-specific revokes to fix - but
-- setting() and current_rider_for_order() never had one (nobody had reason to
-- write "revoke from anon" for a function that looks like a harmless internal
-- helper), so the sweep never looked at them. Both are SECURITY DEFINER, so
-- both bypass RLS entirely for anyone who can call them - and since neither
-- had any grant/revoke statement at all, both still carried Postgres's
-- CREATE FUNCTION default: EXECUTE granted to PUBLIC.
--
-- Confirmed exploitable before this fix: any anon or authenticated caller
-- could POST /rest/v1/rpc/setting with {"p_key": "service_fee_rate"} (or
-- rider_cash_cap_centavos, rider_earning_share, dispatch_search_radius_m,
-- any key in platform_settings) and read it directly, even though that
-- table's own RLS policy restricts SELECT to admins. Same shape for
-- current_rider_for_order: any caller could pass an arbitrary order id and
-- learn which rider was assigned to it, bypassing delivery_assignments' own
-- participant-only read policy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. setting() - only ever called from inside other SECURITY DEFINER
--    functions (price_cart, place_order, dispatch_candidates,
--    auto_dispatch_ready_orders, offer_order_to_rider, create_merchant -
--    confirmed by grepping every call site), never from a raw RLS policy
--    expression. Safe to revoke outright: those callers execute setting()
--    with their own owner privileges regardless of this grant, the same way
--    0024 already relies on for every other internal-only helper.
-- ---------------------------------------------------------------------------
revoke execute on function public.setting(text) from public;

-- ---------------------------------------------------------------------------
-- 2. current_rider_for_order() is different - it IS called directly from a
--    live RLS policy expression (storage.objects, "rider uploads proof of
--    delivery", 0011), which evaluates as the requesting rider's own role,
--    not as a function owner. A bare revoke would break that upload for
--    every legitimate rider. Fix is two-part instead: keep it callable by
--    authenticated (revoke the PUBLIC default, explicitly grant back only to
--    authenticated - never anon, which has no legitimate reason to call this
--    at all), and close the actual data exposure inside the function body by
--    only returning a real answer to someone who could already see this
--    order through can_view_order() (0009) - the same participant check
--    that already gates reading the order itself - or to a genuine internal/
--    cron session via is_internal_session() (0010), which every other
--    function in this file's position already uses for exactly this reason.
--    A caller with no relationship to the order gets NULL back, same as if
--    the order simply had no rider yet - not an error, just nothing to tell
--    them. The one legitimate policy caller (the assigned rider, uploading
--    their own proof of delivery) still gets their own id back, because
--    being the assigned rider is itself one of the ways can_view_order()
--    says yes.
-- ---------------------------------------------------------------------------
create or replace function public.current_rider_for_order(p_order_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.rider_id
  from public.delivery_assignments a
  where a.order_id = p_order_id
    and a.status in ('accepted', 'completed')
    and (public.is_internal_session() or public.can_view_order(p_order_id))
  order by a.offered_at desc
  limit 1;
$$;

revoke execute on function public.current_rider_for_order(uuid) from public;
grant execute on function public.current_rider_for_order(uuid) to authenticated;
