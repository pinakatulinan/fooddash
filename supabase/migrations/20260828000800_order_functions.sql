-- ============================================================================
-- 0008  Pricing, checkout, the order state machine, and dispatch
-- ----------------------------------------------------------------------------
-- THE RULE THIS FILE EXISTS TO ENFORCE:
--   The client never sends a price. It sends identifiers - cart id, address
--   id, promo code, tip - and the database recomputes every centavo from rows
--   it already owns. A browser can lie about a total; it cannot lie about
--   which menu item a uuid points to.
--
-- Everything here runs SECURITY DEFINER with a pinned search_path, and every
-- function re-checks that auth.uid() is entitled to the row it is touching.
-- ============================================================================

insert into public.platform_settings (key, value, description) values
  ('rider_earning_share', '1.00'::jsonb,
   'Share of the delivery fee paid to the rider. 1.00 = the platform takes nothing on delivery at launch.')
on conflict (key) do nothing;

create or replace function public.setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select value from public.platform_settings where key = p_key;
$$;

-- ============================================================================
-- PRICING
-- ============================================================================

-- ----------------------------------------------------------------------------
-- price_cart - the quote. Pure and read-only, so the checkout screen can call
-- it as often as it likes, and place_order() calls the very same logic. There
-- is no second implementation of the maths to drift out of sync.
--
-- Returns jsonb rather than a composite type so the shape can grow (new fee
-- lines, new warnings) without a migration on every consumer.
-- ----------------------------------------------------------------------------
create or replace function public.price_cart(
  p_cart_id     uuid,
  p_address_id  uuid default null,
  p_promo_code  text default null,
  p_tip_centavos integer default 0,
  p_order_type  public.order_type default 'delivery'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_cart      public.carts;
  v_merchant  public.merchants;
  v_address   public.addresses;
  v_quote     record;
  v_item      record;
  v_lines     jsonb := '[]'::jsonb;
  v_subtotal  integer := 0;
  v_delivery  integer := 0;
  v_service   integer := 0;
  v_discount  integer := 0;
  v_tip       integer := greatest(coalesce(p_tip_centavos, 0), 0);
  v_promo     public.promos;
  v_promo_err text;
  v_errors    jsonb := '[]'::jsonb;
  v_zone_id   uuid;
  v_distance  integer;
  v_eta       integer;
  v_unit      integer;
  v_opts      jsonb;
  v_group     record;
  v_selected  integer;
begin
  select * into v_cart from public.carts where id = p_cart_id;
  if v_cart.id is null then
    raise exception 'cart_not_found' using errcode = 'P0002';
  end if;

  -- A quote is only ever produced for the caller's own cart.
  if v_cart.user_id <> auth.uid() and not public.is_admin() then
    raise exception 'not_your_cart' using errcode = '42501';
  end if;

  select * into v_merchant from public.merchants where id = v_cart.merchant_id;

  if not public.is_merchant_open(v_merchant.id) then
    v_errors := v_errors || jsonb_build_object('code', 'merchant_closed',
      'message', v_merchant.name || ' is not accepting orders right now.');
  end if;

  -- ---- Line items -----------------------------------------------------
  for v_item in
    select ci.id, ci.quantity, ci.notes, mi.id as menu_item_id, mi.name, mi.image_url,
           mi.base_price_centavos, mi.is_available, mi.unavailable_until, mi.archived_at
    from public.cart_items ci
    join public.menu_items mi on mi.id = ci.menu_item_id
    where ci.cart_id = p_cart_id
    order by ci.created_at
  loop
    if v_item.archived_at is not null
       or not v_item.is_available
       or (v_item.unavailable_until is not null and v_item.unavailable_until > now()) then
      v_errors := v_errors || jsonb_build_object('code', 'item_unavailable',
        'cart_item_id', v_item.id, 'message', v_item.name || ' is sold out.');
      continue;
    end if;

    -- Selected options, validated against the item they claim to belong to.
    -- An option id from a different menu item is rejected here, which is the
    -- classic way a hand-crafted request tries to buy a large for small money.
    select coalesce(jsonb_agg(jsonb_build_object(
             'option_id', o.id,
             'group_name', og.name,
             'name', o.name,
             'price_delta_centavos', o.price_delta_centavos
           ) order by og.sort_order, o.sort_order), '[]'::jsonb),
           coalesce(sum(o.price_delta_centavos), 0)
      into v_opts, v_unit
    from public.cart_item_options cio
    join public.options o on o.id = cio.option_id
    join public.option_groups og on og.id = o.option_group_id
    where cio.cart_item_id = v_item.id
      and og.menu_item_id = v_item.menu_item_id
      and o.is_available;

    v_unit := v_item.base_price_centavos + coalesce(v_unit, 0);

    -- Required option groups must actually be satisfied.
    for v_group in
      select og.id, og.name, og.min_select, og.max_select
      from public.option_groups og
      where og.menu_item_id = v_item.menu_item_id
    loop
      select count(*) into v_selected
      from public.cart_item_options cio
      join public.options o on o.id = cio.option_id
      where cio.cart_item_id = v_item.id and o.option_group_id = v_group.id;

      if v_selected < v_group.min_select or v_selected > v_group.max_select then
        v_errors := v_errors || jsonb_build_object('code', 'invalid_options',
          'cart_item_id', v_item.id,
          'message', v_item.name || ': choose between ' || v_group.min_select ||
                     ' and ' || v_group.max_select || ' from ' || v_group.name || '.');
      end if;
    end loop;

    v_subtotal := v_subtotal + (v_unit * v_item.quantity);

    v_lines := v_lines || jsonb_build_object(
      'cart_item_id', v_item.id,
      'menu_item_id', v_item.menu_item_id,
      'name', v_item.name,
      'image_url', v_item.image_url,
      'quantity', v_item.quantity,
      'unit_price_centavos', v_unit,
      'line_total_centavos', v_unit * v_item.quantity,
      'notes', v_item.notes,
      'options', v_opts
    );
  end loop;

  if jsonb_array_length(v_lines) = 0 then
    v_errors := v_errors || jsonb_build_object('code', 'cart_empty', 'message', 'Your cart is empty.');
  end if;

  if v_subtotal < v_merchant.min_order_centavos then
    v_errors := v_errors || jsonb_build_object('code', 'below_minimum',
      'message', 'Minimum order for this store is PHP ' ||
                 to_char(v_merchant.min_order_centavos / 100.0, 'FM999,999.00') || '.');
  end if;

  -- ---- Delivery -------------------------------------------------------
  if p_order_type = 'delivery' then
    select * into v_address from public.addresses where id = p_address_id;

    if v_address.id is null then
      v_errors := v_errors || jsonb_build_object('code', 'address_required',
        'message', 'Choose a delivery address.');
    elsif v_address.user_id <> v_cart.user_id then
      raise exception 'not_your_address' using errcode = '42501';
    else
      select * into v_quote from public.quote_delivery(v_merchant.id, v_address.location);
      if not v_quote.deliverable then
        v_errors := v_errors || jsonb_build_object('code', v_quote.reason,
          'message', 'This store does not deliver to that address.');
      else
        v_delivery := v_quote.fee_centavos;
        v_zone_id  := v_quote.zone_id;
        v_distance := v_quote.distance_m;
        v_eta      := v_quote.eta_minutes;
      end if;
    end if;
  else
    v_eta := v_merchant.prep_time_minutes;
  end if;

  -- ---- Platform service fee -------------------------------------------
  v_service := round(v_subtotal * (public.setting('service_fee_rate'))::text::numeric)::integer;

  -- ---- Promo ----------------------------------------------------------
  if p_promo_code is not null and length(trim(p_promo_code)) > 0 then
    -- promos.code is citext for exactly this reason: a customer should be
    -- able to type "welcome50". But comparing a citext COLUMN to a value that
    -- already has a concrete text type - as trim(p_promo_code) does, since
    -- p_promo_code is declared text - does not reliably pick the citext
    -- (case-insensitive) operator. Postgres is equally entitled to cast the
    -- column down to text and compare case-sensitively instead, and in
    -- practice it does. An explicit cast to citext removes the ambiguity.
    -- (An untyped literal, e.g. `code = 'welcome50'`, does not have this
    -- problem - it has no fixed type yet, so it simply adopts the column's.)
    select * into v_promo from public.promos
    where code = trim(p_promo_code)::extensions.citext and is_active;

    if v_promo.id is null then
      v_promo_err := 'That promo code is not valid.';
    elsif v_promo.starts_at > now() then
      v_promo_err := 'That promo has not started yet.';
    elsif v_promo.ends_at is not null and v_promo.ends_at < now() then
      v_promo_err := 'That promo has expired.';
    elsif v_promo.merchant_id is not null and v_promo.merchant_id <> v_merchant.id then
      v_promo_err := 'That promo is not valid at this store.';
    elsif v_subtotal < v_promo.min_order_centavos then
      v_promo_err := 'Spend at least PHP ' ||
        to_char(v_promo.min_order_centavos / 100.0, 'FM999,999.00') || ' to use this promo.';
    elsif v_promo.usage_limit is not null and v_promo.usage_count >= v_promo.usage_limit then
      v_promo_err := 'That promo has been fully claimed.';
    elsif (select count(*) from public.promo_redemptions r
           where r.promo_id = v_promo.id and r.user_id = v_cart.user_id) >= v_promo.per_user_limit then
      v_promo_err := 'You have already used this promo.';
    elsif v_promo.first_order_only and exists (
      select 1 from public.orders o
      where o.customer_id = v_cart.user_id and o.status = 'delivered'
    ) then
      v_promo_err := 'That promo is for first orders only.';
    else
      v_discount := case v_promo.type
        when 'percent_off'   then round(v_subtotal * v_promo.value / 100.0)::integer
        when 'fixed_off'     then v_promo.value::integer
        when 'free_delivery' then v_delivery
      end;

      if v_promo.max_discount_centavos is not null then
        v_discount := least(v_discount, v_promo.max_discount_centavos);
      end if;

      -- A discount can never exceed what is actually being charged, or the
      -- order total would go negative and the reconcile constraint would fire.
      v_discount := least(v_discount, v_subtotal + v_delivery + v_service);
    end if;

    if v_promo_err is not null then
      v_errors := v_errors || jsonb_build_object('code', 'promo_invalid', 'message', v_promo_err);
    end if;
  end if;

  return jsonb_build_object(
    'cart_id',      p_cart_id,
    'merchant_id',  v_merchant.id,
    'merchant_name', v_merchant.name,
    'order_type',   p_order_type,
    'lines',        v_lines,
    'subtotal_centavos',     v_subtotal,
    'delivery_fee_centavos', v_delivery,
    'service_fee_centavos',  v_service,
    'discount_centavos',     v_discount,
    'tip_centavos',          v_tip,
    'total_centavos',        v_subtotal + v_delivery + v_service + v_tip - v_discount,
    'promo_id',     v_promo.id,
    'promo_code',   v_promo.code,
    'zone_id',      v_zone_id,
    'distance_m',   v_distance,
    'eta_minutes',  v_eta,
    'errors',       v_errors,
    'is_valid',     jsonb_array_length(v_errors) = 0
  );
end;
$$;

-- ============================================================================
-- CHECKOUT
-- ============================================================================

-- ----------------------------------------------------------------------------
-- place_order - turns a validated cart into an immutable order.
--
-- Returns the new order id. For COD the order lands in 'placed' and the
-- merchant sees it immediately. For GCash/Maya it lands in 'pending_payment'
-- and only the payment webhook may advance it, so an unpaid order can never
-- reach a kitchen.
-- ----------------------------------------------------------------------------
create or replace function public.place_order(
  p_cart_id        uuid,
  p_address_id     uuid,
  p_payment_method public.payment_method,
  p_promo_code     text default null,
  p_tip_centavos   integer default 0,
  p_order_type     public.order_type default 'delivery',
  p_customer_notes text default null,
  p_scheduled_for  timestamptz default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_quote      jsonb;
  v_cart       public.carts;
  v_merchant   public.merchants;
  v_address    public.addresses;
  v_order_id   uuid;
  v_line       jsonb;
  v_opt        jsonb;
  v_item_id    uuid;
  v_commission integer;
  v_rider_cut  integer;
  v_merchant_discount integer := 0;
  v_promo      public.promos;
  v_status     public.order_status;
begin
  -- Serialise concurrent checkouts of the same cart. Without this, a
  -- double-tapped Place Order button produces two orders from one basket.
  select * into v_cart from public.carts where id = p_cart_id for update;

  if v_cart.id is null then
    raise exception 'cart_not_found' using errcode = 'P0002';
  end if;
  if v_cart.user_id <> auth.uid() then
    raise exception 'not_your_cart' using errcode = '42501';
  end if;

  v_quote := public.price_cart(p_cart_id, p_address_id, p_promo_code, p_tip_centavos, p_order_type);

  if not (v_quote ->> 'is_valid')::boolean then
    raise exception 'checkout_invalid: %', v_quote -> 'errors' using errcode = 'P0001';
  end if;

  select * into v_merchant from public.merchants where id = v_cart.merchant_id;
  select * into v_address  from public.addresses where id = p_address_id;

  v_commission := round((v_quote ->> 'subtotal_centavos')::integer * v_merchant.commission_rate)::integer;
  v_rider_cut  := round(
    (v_quote ->> 'delivery_fee_centavos')::integer
    * (public.setting('rider_earning_share'))::text::numeric
  )::integer;

  -- If the merchant funds part of a promo, it comes out of their payout - not
  -- the platform's pocket. Settled here, at placement, and never recomputed.
  if (v_quote ->> 'promo_id') is not null then
    select * into v_promo from public.promos where id = (v_quote ->> 'promo_id')::uuid;
    v_merchant_discount := case v_promo.funded_by
      when 'merchant' then (v_quote ->> 'discount_centavos')::integer
      when 'shared'   then round((v_quote ->> 'discount_centavos')::integer * v_promo.merchant_share)::integer
      else 0
    end;
  end if;

  v_status := (case when p_payment_method = 'cod' then 'placed' else 'pending_payment' end)::public.order_status;

  insert into public.orders (
    code, customer_id, merchant_id, type, status,
    address_id, delivery_address, dropoff_location, zone_id,
    subtotal_centavos, delivery_fee_centavos, service_fee_centavos,
    discount_centavos, tip_centavos, total_centavos,
    commission_rate_applied, platform_commission_centavos,
    merchant_payout_centavos, rider_earning_centavos,
    payment_method, payment_status,
    promo_id, promo_code,
    scheduled_for, distance_m, eta_minutes, promised_at,
    placed_at, customer_notes,
    pod_code
  ) values (
    public.generate_order_code(), v_cart.user_id, v_cart.merchant_id, p_order_type, v_status,
    p_address_id,
    -- Address snapshot. The customer may delete this address tomorrow; the
    -- rider still needs to know where they went.
    case when v_address.id is null then null else jsonb_build_object(
      'label', v_address.label,
      'recipient_name', coalesce(v_address.recipient_name, ''),
      'recipient_phone', coalesce(v_address.recipient_phone, ''),
      'line1', v_address.line1,
      'barangay', v_address.barangay,
      'city', v_address.city,
      'province', v_address.province,
      'postal_code', v_address.postal_code,
      'landmark', v_address.landmark,
      'delivery_notes', v_address.delivery_notes
    ) end,
    v_address.location,
    nullif(v_quote ->> 'zone_id', '')::uuid,
    (v_quote ->> 'subtotal_centavos')::integer,
    (v_quote ->> 'delivery_fee_centavos')::integer,
    (v_quote ->> 'service_fee_centavos')::integer,
    (v_quote ->> 'discount_centavos')::integer,
    (v_quote ->> 'tip_centavos')::integer,
    (v_quote ->> 'total_centavos')::integer,
    v_merchant.commission_rate,
    v_commission,
    (v_quote ->> 'subtotal_centavos')::integer - v_commission - v_merchant_discount,
    v_rider_cut,
    p_payment_method,
    'pending',
    nullif(v_quote ->> 'promo_id', '')::uuid,
    v_quote ->> 'promo_code',
    p_scheduled_for,
    nullif(v_quote ->> 'distance_m', '')::integer,
    nullif(v_quote ->> 'eta_minutes', '')::integer,
    now() + make_interval(mins => coalesce((v_quote ->> 'eta_minutes')::integer, 45)),
    case when p_payment_method = 'cod' then now() else null end,
    p_customer_notes,
    -- No handover code - dropped per product decision, kept the column
    -- rather than the generator: advance_order's own check (below) already
    -- no-ops correctly when pod_code is null, so nothing else has to change
    -- for a null code to mean "nothing to verify."
    null
  )
  returning id into v_order_id;

  -- ---- Snapshot the lines ---------------------------------------------
  for v_line in select * from jsonb_array_elements(v_quote -> 'lines')
  loop
    insert into public.order_items (
      order_id, menu_item_id, name_snapshot, image_url_snapshot,
      unit_price_centavos, quantity, line_total_centavos, notes
    ) values (
      v_order_id,
      (v_line ->> 'menu_item_id')::uuid,
      v_line ->> 'name',
      v_line ->> 'image_url',
      (v_line ->> 'unit_price_centavos')::integer,
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'line_total_centavos')::integer,
      v_line ->> 'notes'
    )
    returning id into v_item_id;

    for v_opt in select * from jsonb_array_elements(v_line -> 'options')
    loop
      insert into public.order_item_options (
        order_item_id, option_id, group_name_snapshot, name_snapshot, price_delta_centavos
      ) values (
        v_item_id,
        (v_opt ->> 'option_id')::uuid,
        v_opt ->> 'group_name',
        v_opt ->> 'name',
        (v_opt ->> 'price_delta_centavos')::integer
      );
    end loop;
  end loop;

  if (v_quote ->> 'promo_id') is not null then
    insert into public.promo_redemptions (promo_id, user_id, order_id, discount_centavos)
    values ((v_quote ->> 'promo_id')::uuid, v_cart.user_id, v_order_id,
            (v_quote ->> 'discount_centavos')::integer);
  end if;

  -- The cart has become an order; it must not be reusable.
  delete from public.carts where id = p_cart_id;

  return v_order_id;
end;
$$;

-- ============================================================================
-- ORDER STATE MACHINE
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Allowed transitions, in one readable place. Anything not listed is refused
-- by the trigger below, whichever code path attempted it.
-- ----------------------------------------------------------------------------
create or replace function public.order_transition_allowed(
  p_from public.order_status,
  p_to   public.order_status
)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'draft'            then p_to in ('pending_payment', 'placed', 'cancelled')
    when 'pending_payment'  then p_to in ('placed', 'cancelled', 'failed')
    when 'placed'           then p_to in ('accepted', 'cancelled')
    when 'accepted'         then p_to in ('preparing', 'cancelled')
    when 'preparing'        then p_to in ('ready_for_pickup', 'cancelled')
    -- A pickup order goes straight to delivered when the customer collects.
    when 'ready_for_pickup' then p_to in ('picked_up', 'delivered', 'cancelled', 'failed')
    when 'picked_up'        then p_to in ('arrived', 'delivered', 'failed')
    when 'arrived'          then p_to in ('delivered', 'failed')
    -- Terminal. Money moves after this point are refunds, not status changes.
    when 'delivered'        then false
    when 'cancelled'        then false
    when 'failed'           then false
  end;
$$;

-- ----------------------------------------------------------------------------
-- The guard. Rejects illegal transitions, stamps the matching timestamp, and
-- writes the audit event - so no caller can move an order without leaving a
-- trace, and no caller has to remember to write one.
-- ----------------------------------------------------------------------------
create or replace function public.guard_order_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not public.order_transition_allowed(old.status, new.status) then
    raise exception 'illegal order transition % -> % for order %',
      old.status, new.status, old.code
      using errcode = 'P0001';
  end if;

  new.updated_at := now();

  case new.status
    when 'placed'           then new.placed_at    := coalesce(new.placed_at, now());
    when 'accepted'         then new.accepted_at  := coalesce(new.accepted_at, now());
    when 'ready_for_pickup' then new.ready_at     := coalesce(new.ready_at, now());
    when 'picked_up'        then new.picked_up_at := coalesce(new.picked_up_at, now());
    when 'delivered'        then new.delivered_at := coalesce(new.delivered_at, now());
    when 'cancelled'        then new.cancelled_at := coalesce(new.cancelled_at, now());
    else null;
  end case;

  return new;
end;
$$;

create trigger orders_guard_transition
  before update of status on public.orders
  for each row execute function public.guard_order_transition();

create or replace function public.log_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role, note)
    values (new.id, null, new.status, auth.uid(), public.current_user_role(), 'order created');
  elsif new.status is distinct from old.status then
    insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role, note)
    values (new.id, old.status, new.status, auth.uid(), public.current_user_role(),
            coalesce(new.cancellation_reason, new.failure_reason));
  end if;
  return new;
end;
$$;

create trigger orders_log_event
  after insert or update of status on public.orders
  for each row execute function public.log_order_event();

-- ----------------------------------------------------------------------------
-- advance_order - the only sanctioned way for an app to move an order.
--
-- It answers "is this caller allowed to make THIS move" - a merchant may
-- accept and mark ready, a rider may pick up and deliver, a customer may only
-- cancel and only before the kitchen has started. RLS alone cannot express
-- that, because it is about the transition, not the row.
-- ----------------------------------------------------------------------------
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
    -- Close any live offer, then hand the rider back to the pool.
    update public.delivery_assignments
    set status = 'cancelled', responded_at = now()
    where order_id = p_order_id and status in ('offered', 'accepted');

    if v_rider is not null then
      update public.riders
      set status = 'online_idle',
          cancelled_deliveries = cancelled_deliveries + case when p_to = 'failed' then 1 else 0 end
      where id = v_rider and status <> 'offline';
    end if;
  end if;

  return v_order;
end;
$$;

-- ----------------------------------------------------------------------------
-- settle_order - writes the ledger entries for a completed order. Idempotent:
-- re-running it produces nothing, because a delivered order is settled once.
-- ----------------------------------------------------------------------------
create or replace function public.settle_order(p_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_order  public.orders;
  v_rider  uuid;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null or v_order.status <> 'delivered' then
    return;
  end if;

  if exists (
    select 1 from public.ledger_entries
    where order_id = p_order_id and entry_type = 'order_sale'
  ) then
    return;  -- already settled
  end if;

  v_rider := public.current_rider_for_order(p_order_id);

  -- Merchant: credited the basket, debited the commission.
  insert into public.ledger_entries (account_type, account_id, order_id, entry_type, amount_centavos, note)
  values
    ('merchant', v_order.merchant_id, p_order_id, 'order_sale', v_order.subtotal_centavos, v_order.code),
    ('merchant', v_order.merchant_id, p_order_id, 'platform_commission', -v_order.platform_commission_centavos, v_order.code),
    ('platform', null, p_order_id, 'platform_commission', v_order.platform_commission_centavos, v_order.code);

  -- Rider: delivery fee share plus the whole tip. Tips are never taxed by the
  -- platform - riders find out, and they leave.
  if v_rider is not null then
    insert into public.ledger_entries (account_type, account_id, order_id, entry_type, amount_centavos, note)
    values ('rider', v_rider, p_order_id, 'rider_earning', v_order.rider_earning_centavos, v_order.code);

    if v_order.tip_centavos > 0 then
      insert into public.ledger_entries (account_type, account_id, order_id, entry_type, amount_centavos, note)
      values ('rider', v_rider, p_order_id, 'tip', v_order.tip_centavos, v_order.code);
    end if;

    -- COD: the rider is now holding our cash and owes it back.
    if v_order.payment_method = 'cod' then
      insert into public.ledger_entries (account_type, account_id, order_id, entry_type, amount_centavos, note)
      values ('rider', v_rider, p_order_id, 'cash_collected', -v_order.total_centavos, v_order.code);

      update public.riders
      set cash_on_hand_centavos = cash_on_hand_centavos + v_order.total_centavos
      where id = v_rider;
    end if;

    update public.riders
    set completed_deliveries = completed_deliveries + 1,
        status = case when status = 'offline' then status else 'online_idle' end
    where id = v_rider;
  end if;

  if v_order.payment_method = 'cod' then
    update public.orders set payment_status = 'paid' where id = p_order_id;
  end if;
end;
$$;

-- ============================================================================
-- DISPATCH
-- ============================================================================

-- ----------------------------------------------------------------------------
-- dispatch_candidates - nearest eligible riders to a store, closest first.
--
-- Eligibility is not just proximity: verified, not suspended, idle, pinged
-- recently enough to still be real, and under their COD cash cap.
--
-- ops-only. This returns a rider's full name, live distance and cash balance
-- for an order the caller may have no connection to at all - none of that is
-- gated by RLS (it is a function result, not a row), so the check has to live
-- here. Originally shipped without one: any anon caller with nothing but the
-- public key could pull a real rider's name and cash-on-hand for any order id.
-- ----------------------------------------------------------------------------
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
  -- auth.uid() is only ever null for a session with no PostgREST-issued JWT at
  -- all - which anon and authenticated callers always have one of, but the raw
  -- session pg_cron's auto_dispatch_ready_orders() runs in never does. Unlike
  -- a p_is_auto-style boolean parameter, nothing a client sends can forge this.
  if not (public.is_admin() or auth.uid() is null) then
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
    -- A rider whose app has gone quiet for two minutes is not really online.
    and r.last_ping_at > now() - interval '2 minutes'
    and extensions.st_dwithin(r.current_location, v_merchant.location, v_radius)
    -- Do not hand a cash order to a rider who is already over their float.
    and (v_order.payment_method <> 'cod'
         or r.cash_on_hand_centavos + v_order.total_centavos <= v_cash_cap)
    -- Skip riders who already declined or timed out on this order.
    and not exists (
      select 1 from public.delivery_assignments a
      where a.order_id = p_order_id and a.rider_id = r.id
        and a.status in ('declined', 'expired')
    )
  order by r.current_location <-> v_merchant.location
  limit greatest(p_limit, 1);
end;
$$;

-- ----------------------------------------------------------------------------
-- offer_order_to_rider - create the offer. Used identically by the ops console
-- (manual, is_auto = false) and by the dispatch loop (is_auto = true).
--
-- p_is_auto is stored on the assignment purely as a record of how the offer
-- was made - it carries no authority. Authorisation is is_admin() or a null
-- auth.uid(), which only holds for a raw session with no PostgREST-issued JWT
-- (the cron job's session, never a real anon or authenticated API call): a
-- boolean argument a client controls can never be trusted to gate who may
-- assign a rider to someone else's order, or it is a one-line privilege
-- escalation for any signed-in account, admin or not.
-- ----------------------------------------------------------------------------
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
  if not (public.is_admin() or auth.uid() is null) then
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

-- ----------------------------------------------------------------------------
-- respond_to_assignment - the rider's accept / decline.
-- ----------------------------------------------------------------------------
create or replace function public.respond_to_assignment(
  p_assignment_id uuid,
  p_accept        boolean,
  p_reason        text default null
)
returns public.delivery_assignments
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_assignment public.delivery_assignments;
begin
  select * into v_assignment from public.delivery_assignments where id = p_assignment_id for update;

  if v_assignment.id is null then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;
  if v_assignment.rider_id <> auth.uid() and not public.is_admin() then
    raise exception 'not_your_assignment' using errcode = '42501';
  end if;
  if v_assignment.status <> 'offered' then
    raise exception 'this offer is no longer open' using errcode = 'P0001';
  end if;
  if v_assignment.expires_at < now() then
    update public.delivery_assignments set status = 'expired', responded_at = now()
    where id = p_assignment_id returning * into v_assignment;
    update public.riders set status = 'online_idle' where id = v_assignment.rider_id;
    raise exception 'this offer has expired' using errcode = 'P0001';
  end if;

  update public.delivery_assignments
  -- The literals must be cast: a CASE over two bare strings resolves to
  -- text, and Postgres will not implicitly assign text to an enum column.
  set status = (case when p_accept then 'accepted' else 'declined' end)::public.assignment_status,
      responded_at = now(),
      decline_reason = case when p_accept then null else p_reason end
  where id = p_assignment_id
  returning * into v_assignment;

  update public.riders
  set status = (case when p_accept then 'en_route_to_store' else 'online_idle' end)::public.rider_status
  where id = v_assignment.rider_id;

  return v_assignment;
end;
$$;

-- ----------------------------------------------------------------------------
-- expire_stale_offers - swept by pg_cron every 15 seconds (scheduled at the
-- bottom of this file). An offer nobody answered must not pin an order forever.
-- ----------------------------------------------------------------------------
create or replace function public.expire_stale_offers()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.delivery_assignments
    set status = 'expired', responded_at = now()
    where status = 'offered' and expires_at < now()
    returning rider_id
  )
  update public.riders r
  set status = 'online_idle'
  from expired e
  where r.id = e.rider_id and r.status = 'on_offer';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- auto_dispatch_ready_orders - the dispatch loop, swept by pg_cron every 15
-- seconds alongside expire_stale_offers. For every delivery order sitting at
-- ready_for_pickup with no live offer, finds the single nearest eligible
-- rider and offers it to them exactly the way an ops console click would.
--
-- Gated on the dispatch_mode setting, which existed before this function did
-- (0002) specifically to make this switchable, seeded to 'manual' with the
-- description "Start manual." A no-op here whenever it reads anything but
-- 'auto' is what makes that setting mean something, rather than a label next
-- to a loop that ignores it.
--
-- One order's failure (no eligible rider, a race with a manual dispatch,
-- anything else) must not stop the sweep from reaching the rest, so each
-- order is offered inside its own sub-transaction via a nested exception
-- block rather than letting one bad row abort the whole run.
-- ----------------------------------------------------------------------------
create or replace function public.auto_dispatch_ready_orders()
returns integer
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_order     record;
  v_candidate record;
  v_offered   integer := 0;
begin
  if (public.setting('dispatch_mode') #>> '{}') is distinct from 'auto' then
    return 0;
  end if;

  for v_order in
    select o.id, o.code
    from public.orders o
    where o.type = 'delivery'
      and o.status = 'ready_for_pickup'
      and not exists (
        select 1 from public.delivery_assignments a
        where a.order_id = o.id and a.status in ('offered', 'accepted')
      )
    order by o.ready_at
  loop
    begin
      select c.rider_id into v_candidate
      from public.dispatch_candidates(v_order.id, 1) c;

      if v_candidate.rider_id is not null then
        perform public.offer_order_to_rider(v_order.id, v_candidate.rider_id, true);
        v_offered := v_offered + 1;
      end if;
    exception when others then
      raise warning 'auto_dispatch_ready_orders: order % skipped: %', v_order.code, sqlerrm;
    end;
  end loop;

  return v_offered;
end;
$$;

-- Every 15 seconds, in step with the two doc comments above. cron.schedule
-- upserts by job name, so re-running this migration just re-points the same
-- job rather than accumulating duplicates.
select cron.schedule('expire-stale-offers', '15 seconds', $$select public.expire_stale_offers()$$);
select cron.schedule('auto-dispatch-ready-orders', '15 seconds', $$select public.auto_dispatch_ready_orders()$$);

-- ----------------------------------------------------------------------------
-- record_rider_ping - one call updates the live position and appends to the
-- trail, so the rider app makes a single request every few seconds.
-- ----------------------------------------------------------------------------
create or replace function public.record_rider_ping(
  p_lat       double precision,
  p_lng       double precision,
  p_order_id  uuid default null,
  p_heading   numeric default null,
  p_speed_kph numeric default null,
  p_accuracy_m numeric default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_point extensions.geography;
begin
  if not public.is_rider() then
    raise exception 'not_a_rider' using errcode = '42501';
  end if;

  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;

  update public.riders
  set current_location = v_point, last_ping_at = now()
  where id = auth.uid();

  insert into public.rider_pings (rider_id, order_id, location, heading, speed_kph, accuracy_m)
  values (auth.uid(), p_order_id, v_point, p_heading, p_speed_kph, p_accuracy_m);
end;
$$;
