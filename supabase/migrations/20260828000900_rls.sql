-- ============================================================================
-- 0009  Row Level Security
-- ----------------------------------------------------------------------------
-- This file is the actual security boundary of the product. Not the Next.js
-- middleware, not the route guards - those are UX. If a policy here is wrong,
-- a merchant can read a competitor's orders with nothing but their own API key
-- and curl.
--
-- Two conventions run through the whole file:
--
--   1. Deny by default. RLS is enabled on every table; a table with no policy
--      for an action simply cannot perform it from a client. Orders, for
--      instance, have NO insert or update policy at all - they can only be
--      created by place_order() and moved by advance_order(), both of which
--      are SECURITY DEFINER and do their own entitlement checks.
--
--   2. Privileged writes use the service role from server-side code, never a
--      broad admin policy. An admin acting through the client gets exactly the
--      same reads as ops needs and no more.
-- ============================================================================

alter table public.profiles              enable row level security;
alter table public.addresses             enable row level security;
alter table public.notifications         enable row level security;
alter table public.push_subscriptions    enable row level security;
alter table public.platform_settings     enable row level security;
alter table public.admin_audit_log       enable row level security;
alter table public.merchants             enable row level security;
alter table public.merchant_members      enable row level security;
alter table public.merchant_documents    enable row level security;
alter table public.merchant_hours        enable row level security;
alter table public.merchant_closures     enable row level security;
alter table public.menu_categories       enable row level security;
alter table public.menu_items            enable row level security;
alter table public.option_groups         enable row level security;
alter table public.options               enable row level security;
alter table public.service_zones         enable row level security;
alter table public.carts                 enable row level security;
alter table public.cart_items            enable row level security;
alter table public.cart_item_options     enable row level security;
alter table public.orders                enable row level security;
alter table public.order_items           enable row level security;
alter table public.order_item_options    enable row level security;
alter table public.order_events          enable row level security;
alter table public.reviews               enable row level security;
alter table public.riders                enable row level security;
alter table public.rider_documents       enable row level security;
alter table public.rider_shifts          enable row level security;
alter table public.rider_pings           enable row level security;
alter table public.delivery_assignments  enable row level security;
alter table public.promos                enable row level security;
alter table public.promo_redemptions     enable row level security;
alter table public.payments              enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.refunds               enable row level security;
alter table public.ledger_entries        enable row level security;
alter table public.payouts               enable row level security;
alter table public.rider_remittances     enable row level security;
alter table public.support_tickets       enable row level security;
alter table public.support_messages      enable row level security;

-- ----------------------------------------------------------------------------
-- can_view_order - one definition of "is this order any of your business",
-- reused by order_items, options, events, payments and assignments so those
-- five tables cannot drift apart from the orders policy.
-- ----------------------------------------------------------------------------
create or replace function public.can_view_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and (
        o.customer_id = auth.uid()
        or public.is_merchant_member(o.merchant_id)
        or exists (
          select 1 from public.delivery_assignments a
          where a.order_id = o.id
            and a.rider_id = auth.uid()
            and a.status in ('offered', 'accepted', 'completed')
        )
        or public.is_admin()
      )
  );
$$;

-- ============================================================================
-- Identity
-- ============================================================================

create policy profiles_select_self on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- Name, phone and avatar only. Role, is_blocked and phone_verified_at are
-- withheld by the column grants at the bottom of this file, so a user cannot
-- promote themselves to admin by patching their own profile row.
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy addresses_own on public.addresses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy addresses_admin_read on public.addresses
  for select using (public.is_admin());

create policy notifications_own on public.notifications
  for select using (user_id = auth.uid());

create policy notifications_mark_read on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy push_subscriptions_own on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy platform_settings_admin_read on public.platform_settings
  for select using (public.is_admin());

create policy admin_audit_log_admin_read on public.admin_audit_log
  for select using (public.is_admin());
-- Deliberately no insert/update/delete policy: the audit log is written by the
-- service role only, and is never editable by anyone.

-- ============================================================================
-- Merchants and menu
-- ============================================================================

-- The storefront. Anonymous browsing is a requirement: people must be able to
-- see what is available before they sign up.
create policy merchants_public_read on public.merchants
  for select using (status = 'approved');

create policy merchants_member_read on public.merchants
  for select using (public.is_merchant_member(id) or public.is_admin());

create policy merchants_member_update on public.merchants
  for update using (public.is_merchant_member(id)) with check (public.is_merchant_member(id));

create policy merchant_members_read on public.merchant_members
  for select using (user_id = auth.uid() or public.is_merchant_member(merchant_id) or public.is_admin());

create policy merchant_members_owner_manage on public.merchant_members
  for all using (public.is_merchant_owner(merchant_id))
  with check (public.is_merchant_owner(merchant_id));

create policy merchant_documents_member on public.merchant_documents
  for all using (public.is_merchant_member(merchant_id) or public.is_admin())
  with check (public.is_merchant_member(merchant_id));

create policy merchant_hours_public_read on public.merchant_hours
  for select using (true);

create policy merchant_hours_member_manage on public.merchant_hours
  for all using (public.is_merchant_member(merchant_id))
  with check (public.is_merchant_member(merchant_id));

create policy merchant_closures_public_read on public.merchant_closures
  for select using (true);

create policy merchant_closures_member_manage on public.merchant_closures
  for all using (public.is_merchant_member(merchant_id))
  with check (public.is_merchant_member(merchant_id));

create policy menu_categories_public_read on public.menu_categories
  for select using (
    is_active and exists (
      select 1 from public.merchants m where m.id = merchant_id and m.status = 'approved'
    )
  );

create policy menu_categories_member_manage on public.menu_categories
  for all using (public.is_merchant_member(merchant_id))
  with check (public.is_merchant_member(merchant_id));

create policy menu_items_public_read on public.menu_items
  for select using (
    archived_at is null and exists (
      select 1 from public.merchants m where m.id = merchant_id and m.status = 'approved'
    )
  );

create policy menu_items_member_manage on public.menu_items
  for all using (public.is_merchant_member(merchant_id))
  with check (public.is_merchant_member(merchant_id));

create policy option_groups_public_read on public.option_groups
  for select using (
    exists (
      select 1 from public.menu_items mi
      join public.merchants m on m.id = mi.merchant_id
      where mi.id = menu_item_id and m.status = 'approved' and mi.archived_at is null
    )
  );

create policy option_groups_member_manage on public.option_groups
  for all using (
    exists (select 1 from public.menu_items mi
            where mi.id = menu_item_id and public.is_merchant_member(mi.merchant_id))
  )
  with check (
    exists (select 1 from public.menu_items mi
            where mi.id = menu_item_id and public.is_merchant_member(mi.merchant_id))
  );

create policy options_public_read on public.options
  for select using (
    exists (
      select 1 from public.option_groups og
      join public.menu_items mi on mi.id = og.menu_item_id
      join public.merchants m on m.id = mi.merchant_id
      where og.id = option_group_id and m.status = 'approved' and mi.archived_at is null
    )
  );

create policy options_member_manage on public.options
  for all using (
    exists (select 1 from public.option_groups og
            join public.menu_items mi on mi.id = og.menu_item_id
            where og.id = option_group_id and public.is_merchant_member(mi.merchant_id))
  )
  with check (
    exists (select 1 from public.option_groups og
            join public.menu_items mi on mi.id = og.menu_item_id
            where og.id = option_group_id and public.is_merchant_member(mi.merchant_id))
  );

-- Customers need to know whether their barangay is covered before they order.
create policy service_zones_public_read on public.service_zones
  for select using (is_active);

-- ============================================================================
-- Carts
-- ============================================================================

create policy carts_own on public.carts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy cart_items_own on public.cart_items
  for all using (
    exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid())
  );

create policy cart_item_options_own on public.cart_item_options
  for all using (
    exists (select 1 from public.cart_items ci
            join public.carts c on c.id = ci.cart_id
            where ci.id = cart_item_id and c.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.cart_items ci
            join public.carts c on c.id = ci.cart_id
            where ci.id = cart_item_id and c.user_id = auth.uid())
  );

-- ============================================================================
-- Orders
--
-- Read-only from every client. Creation is place_order(); every status change
-- is advance_order(). There is no policy that lets a merchant UPDATE an order
-- row directly, which is what makes the state machine unbypassable.
-- ============================================================================

create policy orders_participants_read on public.orders
  for select using (
    customer_id = auth.uid()
    or public.is_merchant_member(merchant_id)
    or exists (
      select 1 from public.delivery_assignments a
      where a.order_id = orders.id and a.rider_id = auth.uid()
        and a.status in ('offered', 'accepted', 'completed')
    )
    or public.is_admin()
  );

create policy order_items_read on public.order_items
  for select using (public.can_view_order(order_id));

create policy order_item_options_read on public.order_item_options
  for select using (
    exists (select 1 from public.order_items oi
            where oi.id = order_item_id and public.can_view_order(oi.order_id))
  );

create policy order_events_read on public.order_events
  for select using (public.can_view_order(order_id));

-- ============================================================================
-- Reviews
-- ============================================================================

create policy reviews_public_read on public.reviews
  for select using (not is_hidden or public.is_admin());

create policy reviews_customer_write on public.reviews
  for insert with check (
    customer_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id and o.customer_id = auth.uid() and o.status = 'delivered'
    )
  );

-- The write policy above only checks that the order is really this
-- customer's and really delivered - it never checks that merchant_id/rider_id
-- on the row actually match that order. Left alone, a customer with one real
-- delivered order could aim a review at any merchant or rider in the system,
-- not just the one they ordered from - reputation gets manipulated with a
-- review that is otherwise entirely legitimate by the write policy's own
-- rules. Both foreign keys are resolved from the order itself and whatever
-- the client sent for them is discarded, the same way enforce_promo_funding
-- (above) discards a merchant's own funded_by/merchant_share.
create or replace function public.enforce_review_targets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = new.order_id;
  new.merchant_id := v_order.merchant_id;
  new.rider_id := public.current_rider_for_order(new.order_id);
  return new;
end;
$$;

create trigger reviews_enforce_targets
  before insert on public.reviews
  for each row execute function public.enforce_review_targets();

-- Same rollup as refresh_merchant_rating just above, but riders.rating_avg
-- never had an equivalent - the column has sat dormant since the schema was
-- written, updated by nothing.
create or replace function public.refresh_rider_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider_id uuid := coalesce(new.rider_id, old.rider_id);
begin
  if v_rider_id is null then
    return coalesce(new, old);
  end if;

  update public.riders r
  set rating_avg = coalesce(agg.avg_rating, 0),
      rating_count = coalesce(agg.n, 0)
  from (
    select avg(rider_rating)::numeric(3, 2) as avg_rating, count(*) as n
    from public.reviews
    where rider_id = v_rider_id
      and rider_rating is not null
      and not is_hidden
  ) agg
  where r.id = v_rider_id;

  return coalesce(new, old);
end;
$$;

create trigger reviews_refresh_rider_rating
  after insert or update or delete on public.reviews
  for each row execute function public.refresh_rider_rating();

-- ============================================================================
-- Riders and dispatch
-- ============================================================================

create policy riders_self_read on public.riders
  for select using (id = auth.uid() or public.is_admin());

create policy riders_self_update on public.riders
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy riders_self_insert on public.riders
  for insert with check (id = auth.uid());

create policy rider_documents_own on public.rider_documents
  for all using (rider_id = auth.uid() or public.is_admin())
  with check (rider_id = auth.uid());

create policy rider_shifts_own on public.rider_shifts
  for all using (rider_id = auth.uid() or public.is_admin())
  with check (rider_id = auth.uid());

-- Pings are written through record_rider_ping(); reads stay narrow because a
-- location trail is the most sensitive data in the system.
create policy rider_pings_own_read on public.rider_pings
  for select using (rider_id = auth.uid() or public.is_admin());

create policy delivery_assignments_read on public.delivery_assignments
  for select using (
    rider_id = auth.uid() or public.can_view_order(order_id)
  );

-- ============================================================================
-- Promos
-- ============================================================================

create policy promos_public_read on public.promos
  for select using (
    is_active and starts_at <= now() and (ends_at is null or ends_at > now())
  );

create policy promos_merchant_manage on public.promos
  for all using (merchant_id is not null and public.is_merchant_member(merchant_id))
  with check (merchant_id is not null and public.is_merchant_member(merchant_id));

-- RLS alone lets a merchant member write funded_by/merchant_share on their own
-- store's promo same as any other column - which would let them stick the
-- platform with the bill for their own discount without ops ever approving
-- it. A store-scoped promo written by anyone other than an admin always pays
-- for itself; only an admin (creating a platform-wide or platform-funded
-- promo) can make funded_by/merchant_share mean anything else.
create or replace function public.enforce_promo_funding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.merchant_id is not null and not public.is_admin() then
    new.funded_by := 'merchant';
    new.merchant_share := 1;
  end if;
  return new;
end;
$$;

create trigger promos_enforce_funding
  before insert or update on public.promos
  for each row execute function public.enforce_promo_funding();

create policy promo_redemptions_own_read on public.promo_redemptions
  for select using (user_id = auth.uid() or public.is_admin());

-- ============================================================================
-- Money
--
-- Nothing here is client-writable. Payments are created by the checkout Edge
-- Function, ledger entries by settle_order(), payouts by the payout runner -
-- all with the service role.
-- ============================================================================

create policy payments_read on public.payments
  for select using (public.can_view_order(order_id));

create policy refunds_read on public.refunds
  for select using (public.can_view_order(order_id));

create policy ledger_entries_own_read on public.ledger_entries
  for select using (
    public.is_admin()
    or (account_type = 'rider' and account_id = auth.uid())
    or (account_type = 'merchant' and public.is_merchant_member(account_id))
  );

create policy payouts_own_read on public.payouts
  for select using (
    public.is_admin()
    or (payee_type = 'rider' and payee_id = auth.uid())
    or (payee_type = 'merchant' and public.is_merchant_member(payee_id))
  );

create policy rider_remittances_own on public.rider_remittances
  for select using (rider_id = auth.uid() or public.is_admin());

create policy rider_remittances_declare on public.rider_remittances
  for insert with check (rider_id = auth.uid());

-- payment_webhook_events has RLS on and no policies at all: only the service
-- role touches it, and nothing about a provider payload belongs to a user.

-- ============================================================================
-- Support
-- ============================================================================

create policy support_tickets_own on public.support_tickets
  for select using (raised_by = auth.uid() or public.is_admin());

create policy support_tickets_raise on public.support_tickets
  for insert with check (raised_by = auth.uid());

-- Unlike platform_settings/service_zones, nothing here calls for walling this
-- off behind an RPC - there is no business rule beyond "only staff touch it",
-- which RLS already states plainly. Column grants below restrict *which*
-- columns even that gets: status, assigned_to and resolution, never someone
-- else's original report.
create policy support_tickets_admin_manage on public.support_tickets
  for update using (public.is_admin())
  with check (public.is_admin());

-- A resolved_at that only ever matches the moment status actually became
-- resolved/closed, whether that update came from a form or a raw client -
-- and clears itself the moment the ticket is reopened, so a reopened ticket
-- never reads as resolved six days before it was reopened.
create or replace function public.stamp_ticket_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    new.resolved_at := now();
  elsif new.status not in ('resolved', 'closed') then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

create trigger support_tickets_stamp_resolved
  before update of status on public.support_tickets
  for each row execute function public.stamp_ticket_resolved();

create policy support_messages_read on public.support_messages
  for select using (
    public.is_admin()
    or (not is_internal and exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and t.raised_by = auth.uid()
    ))
  );

create policy support_messages_write on public.support_messages
  for insert with check (
    author_id = auth.uid()
    and (
      public.is_admin()
      or (not is_internal and exists (
        select 1 from public.support_tickets t
        where t.id = ticket_id and t.raised_by = auth.uid()
      ))
    )
  );

-- ============================================================================
-- Column-level grants
--
-- RLS decides which ROWS you may touch; it cannot say which COLUMNS. These
-- grants are what stop a user from patching a column they can legitimately
-- see - the classic being profiles.role, where a single PATCH would otherwise
-- make any customer an admin.
-- ============================================================================

revoke update on public.profiles from authenticated;
grant update (full_name, phone, avatar_url, locale) on public.profiles to authenticated;

revoke update on public.merchants from authenticated;
grant update (
  name, tagline, description, logo_url, cover_url, phone, email,
  line1, barangay, city, province, postal_code, location,
  min_order_centavos, prep_time_minutes,
  is_accepting_orders, paused_until, pause_reason,
  payout_method, payout_account_name, payout_account_number
) on public.merchants to authenticated;
-- Withheld on purpose: status, commission_rate, delivery_radius_m, rating_*,
-- approved_at/by. Commercial terms are set by ops, not by the merchant.

revoke update on public.riders from authenticated;
grant update (vehicle, plate_number, status, home_zone_id) on public.riders to authenticated;
-- Withheld: is_verified, is_suspended, cash_on_hand_centavos, rating_*,
-- completed_deliveries. A rider must not be able to zero their own cash float.

revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Anonymous visitors browse the storefront and nothing else.
revoke all on public.orders          from anon;
revoke all on public.order_items     from anon;
revoke all on public.order_item_options from anon;
revoke all on public.order_events    from anon;
revoke all on public.carts           from anon;
revoke all on public.cart_items      from anon;
revoke all on public.cart_item_options from anon;
revoke all on public.addresses       from anon;
revoke all on public.profiles        from anon;
revoke all on public.riders          from anon;
revoke all on public.rider_pings     from anon;
revoke all on public.rider_documents from anon;
revoke all on public.delivery_assignments from anon;
revoke all on public.payments        from anon;
revoke all on public.refunds         from anon;
revoke all on public.ledger_entries  from anon;
revoke all on public.payouts         from anon;
revoke all on public.rider_remittances from anon;
revoke all on public.promo_redemptions from anon;
revoke all on public.notifications   from anon;
revoke all on public.push_subscriptions from anon;
revoke all on public.support_tickets from anon;
-- The RLS policy above already limits UPDATE to admins; this stops even an
-- admin session from patching category/subject/body/raised_by - someone
-- else's account of what happened, not staff's to rewrite.
revoke update on public.support_tickets from authenticated;
grant update (status, assigned_to, resolution) on public.support_tickets to authenticated;
revoke all on public.support_messages from anon;
revoke all on public.merchant_documents from anon;
revoke all on public.merchant_members from anon;
-- Settings stay readable to admins through their policy, but nobody edits
-- operational knobs from a browser session.
revoke all on public.platform_settings from anon;
revoke insert, update, delete on public.platform_settings from authenticated;
revoke all on public.admin_audit_log from anon;
revoke all on public.payment_webhook_events from anon, authenticated;

-- ============================================================================
-- Function execution grants
--
-- SECURITY DEFINER functions run with the definer's rights, so EXECUTE is the
-- only thing standing between a caller and that privilege. Grant deliberately.
-- ============================================================================

revoke execute on function public.settle_order(uuid) from anon, authenticated;
revoke execute on function public.expire_stale_offers() from anon, authenticated;
revoke execute on function public.auto_dispatch_ready_orders() from anon, authenticated;
revoke execute on function public.offer_order_to_rider(uuid, uuid, boolean) from anon;
-- dispatch_candidates has no RLS to fall back on - it returns a rider's name,
-- distance and cash balance as a function result, not table rows, so the
-- grant here plus the is_admin()-or-null-auth.uid() check inside the function
-- (0008) are the only wall. A signed-in, non-admin caller always has a real
-- auth.uid(), so this call is refused for them exactly as before; only the
-- cron job's own session (no PostgREST JWT at all) or a true admin gets through.
revoke execute on function public.dispatch_candidates(uuid, integer) from anon;
grant execute on function public.dispatch_candidates(uuid, integer) to authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.pause_store(uuid, integer, text) from anon;
revoke execute on function public.resume_store(uuid) from anon;
revoke execute on function public.update_platform_setting(text, jsonb, text) from anon;
revoke execute on function public.update_service_zone(uuid, boolean, integer, numeric, integer, boolean, text) from anon;

grant execute on function public.price_cart(uuid, uuid, text, integer, public.order_type) to authenticated;
grant execute on function public.place_order(uuid, uuid, public.payment_method, text, integer, public.order_type, text, timestamptz) to authenticated;
grant execute on function public.advance_order(uuid, public.order_status, text, text) to authenticated;
grant execute on function public.respond_to_assignment(uuid, boolean, text) to authenticated;
grant execute on function public.record_rider_ping(double precision, double precision, uuid, numeric, numeric, numeric) to authenticated;
grant execute on function public.quote_delivery(uuid, extensions.geography) to anon, authenticated;
grant execute on function public.is_merchant_open(uuid, timestamptz) to anon, authenticated;

-- ============================================================================
-- Notifications
--
-- notifications has no insert policy for anyone (only notifications_own for
-- select and notifications_mark_read for the read_at column) - a user must
-- never be able to write a notification to themselves or anyone else. These
-- triggers are the only path that ever populates the table, running with
-- their own SECURITY DEFINER privileges rather than the caller's.
-- ============================================================================

create or replace function public.notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider_id uuid;
  v_amount   text;
begin
  -- A same-status touch (a metadata-only update) is not a transition anyone
  -- needs telling about - only insert (the order's first status) and a real
  -- change fall through to the case below.
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  case new.status
    when 'placed' then
      v_amount := to_char(new.total_centavos / 100.0, 'FM999999990.00');
      insert into public.notifications (user_id, type, title, body, data)
      select mm.user_id, 'order_placed', 'New order ' || new.code,
             '₱' || v_amount || ' - accept or decline it from your queue.',
             jsonb_build_object('order_id', new.id)
      from public.merchant_members mm
      where mm.merchant_id = new.merchant_id;

    when 'accepted' then
      insert into public.notifications (user_id, type, title, body, data)
      values (new.customer_id, 'order_accepted', 'Order accepted',
              'The kitchen started preparing your order.', jsonb_build_object('order_id', new.id));

    when 'picked_up' then
      insert into public.notifications (user_id, type, title, body, data)
      values (new.customer_id, 'order_picked_up', 'Your rider is on the way',
              'Order ' || new.code || ' has been picked up.', jsonb_build_object('order_id', new.id));

    when 'delivered' then
      insert into public.notifications (user_id, type, title, body, data)
      values (new.customer_id, 'order_delivered', 'Order delivered',
              'Enjoy your meal! Let us know how it went.', jsonb_build_object('order_id', new.id));

    when 'cancelled' then
      insert into public.notifications (user_id, type, title, body, data)
      values (new.customer_id, 'order_cancelled', 'Order cancelled',
              coalesce(new.cancellation_reason, 'This order was cancelled.'),
              jsonb_build_object('order_id', new.id));

      -- Resolved before the cancel branch of advance_order (0008) clears the
      -- assignment itself, so the rider who had it is still findable here.
      v_rider_id := public.current_rider_for_order(new.id);
      if v_rider_id is not null then
        insert into public.notifications (user_id, type, title, body, data)
        values (v_rider_id, 'order_cancelled', 'Delivery cancelled',
                'Order ' || new.code || ' was cancelled - nothing more to do here.',
                jsonb_build_object('order_id', new.id));
      end if;

    when 'failed' then
      insert into public.notifications (user_id, type, title, body, data)
      values (new.customer_id, 'order_failed', 'We could not complete this delivery',
              coalesce(new.failure_reason, 'Something went wrong with this delivery.'),
              jsonb_build_object('order_id', new.id));

    else
      null;
  end case;

  return new;
end;
$$;

create trigger orders_notify_status_change
  after insert or update of status on public.orders
  for each row execute function public.notify_order_status_change();

-- A staff reply reaches the customer; the customer's own message echoing
-- back to them does not, and neither does an internal note (is_internal is
-- staff-only by definition - see support_messages_read, above).
create or replace function public.notify_ticket_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.support_tickets;
begin
  if new.is_internal then
    return new;
  end if;

  select * into v_ticket from public.support_tickets where id = new.ticket_id;

  if new.author_id <> v_ticket.raised_by then
    insert into public.notifications (user_id, type, title, body, data)
    values (
      v_ticket.raised_by, 'ticket_reply', 'New reply on "' || v_ticket.subject || '"',
      new.body, jsonb_build_object('ticket_id', v_ticket.id, 'order_id', v_ticket.order_id)
    );
  end if;

  return new;
end;
$$;

create trigger support_messages_notify
  after insert on public.support_messages
  for each row execute function public.notify_ticket_message();

create or replace function public.notify_ticket_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    insert into public.notifications (user_id, type, title, body, data)
    values (
      new.raised_by, 'ticket_resolved', 'Your ticket was resolved',
      coalesce(new.resolution, 'Your reported issue has been resolved.'),
      jsonb_build_object('ticket_id', new.id, 'order_id', new.order_id)
    );
  end if;
  return new;
end;
$$;

create trigger support_tickets_notify_resolved
  after update of status on public.support_tickets
  for each row execute function public.notify_ticket_resolved();
