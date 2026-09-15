-- ============================================================================
-- 0011  Application RPCs
-- ----------------------------------------------------------------------------
-- The handful of operations that are awkward or unsafe as raw table writes:
-- multi-table creates, the discovery query, and the tracking payload that
-- needs to reveal a little about the rider without opening up profiles.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- create_merchant - store row plus owner membership in one transaction, so a
-- store can never exist with nobody able to administer it.
-- ----------------------------------------------------------------------------
create or replace function public.create_merchant(
  p_name     text,
  p_phone    text default null,
  p_city     text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_id   uuid;
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not (public.setting('accepting_signups'))::text::boolean then
    raise exception 'merchant signups are paused' using errcode = 'P0001';
  end if;

  -- Slugify, then de-duplicate with a short suffix. Two branches of the same
  -- carinderia signing up is normal, not an error.
  v_slug := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then v_slug := 'store'; end if;

  -- merchants.slug is citext; cast explicitly for the same reason price_cart's
  -- promo lookup does (see 0008) - v_slug already arrives lowercase from the
  -- regexp above, so this one is defensive rather than a live bug, but it is
  -- the same trap and worth closing off before it is copied somewhere it matters.
  while exists (select 1 from public.merchants where slug = v_slug::extensions.citext) loop
    v_slug := v_slug || '-' || substr(extensions.gen_random_uuid()::text, 1, 4);
  end loop;

  insert into public.merchants (
    slug, name, phone, city, status,
    commission_rate
  ) values (
    v_slug, trim(p_name), p_phone, p_city, 'draft',
    (public.setting('default_commission_rate'))::text::numeric
  )
  returning id into v_id;

  insert into public.merchant_members (merchant_id, user_id, is_owner)
  values (v_id, auth.uid(), true);

  -- A merchant account is still a customer account; the role just widens.
  update public.profiles set role = 'merchant'
  where id = auth.uid() and role = 'customer';

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- pause_store / resume_store - the merchant's own open/closed switch.
--
-- is_merchant_open() (0003) treats these as two different kinds of closed: a
-- p_minutes pause leaves is_accepting_orders on and relies on paused_until
-- lapsing to reopen the store on its own, while an indefinite pause
-- (p_minutes null) flips is_accepting_orders off with no expiry - someone has
-- to come back and resume it.
--
-- The interval is computed here with now(), not passed in as a client-built
-- timestamp: a browser's clock is not something this function can trust to
-- agree with the database's, and a merchant who asks for "30 minutes" should
-- get thirty real minutes regardless of what their device's clock reads.
-- ----------------------------------------------------------------------------
create or replace function public.pause_store(
  p_merchant_id uuid,
  p_minutes     integer default null,
  p_reason      text default null
)
returns public.merchants
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_merchant public.merchants;
begin
  if not public.is_merchant_member(p_merchant_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_minutes is not null and p_minutes <= 0 then
    raise exception 'pause duration must be positive' using errcode = 'P0001';
  end if;

  update public.merchants
  set is_accepting_orders = (p_minutes is not null),
      paused_until = case when p_minutes is not null then now() + make_interval(mins => p_minutes) end,
      pause_reason = p_reason
  where id = p_merchant_id
  returning * into v_merchant;

  return v_merchant;
end;
$$;

create or replace function public.resume_store(p_merchant_id uuid)
returns public.merchants
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_merchant public.merchants;
begin
  if not public.is_merchant_member(p_merchant_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  update public.merchants
  set is_accepting_orders = true, paused_until = null, pause_reason = null
  where id = p_merchant_id
  returning * into v_merchant;

  return v_merchant;
end;
$$;

-- ----------------------------------------------------------------------------
-- update_platform_setting / update_service_zone - the only way any admin
-- session can change either table. Both have no write policy for anyone
-- (0009) - platform_settings' own comment on the settings page calls this
-- "a service-role write with an audit entry", and these two RPCs are that
-- write: SECURITY DEFINER stands in for the elevated access, is_admin() is
-- the gate a raw service-role key would not have needed, and every change is
-- written to admin_audit_log in the same transaction as the update, so
-- "editable" and "audited" are not two separate things to get right.
-- ----------------------------------------------------------------------------
create or replace function public.update_platform_setting(
  p_key   text,
  p_value jsonb,
  p_note  text default null
)
returns public.platform_settings
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_row    public.platform_settings;
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select value into v_before from public.platform_settings where key = p_key;
  if v_before is null then
    raise exception 'unknown setting %', p_key using errcode = 'P0002';
  end if;

  update public.platform_settings
  set value = p_value, updated_by = auth.uid()
  where key = p_key
  returning * into v_row;

  insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (auth.uid(), 'update_setting', 'platform_settings', p_key, v_before, p_value, p_note);

  return v_row;
end;
$$;

create or replace function public.update_service_zone(
  p_zone_id           uuid,
  p_is_active         boolean,
  p_base_fee_centavos integer,
  -- Three-way, not a plain overwrite: editing the base fee alone must not
  -- silently wipe out or restart whatever surge is already running.
  --   p_surge_minutes given  -> start a NEW surge_until (now() + minutes,
  --                             against the database's clock, same reason as
  --                             pause_store's p_minutes above) at p_surge_multiplier
  --   p_clear_surge true     -> end any active surge now
  --   neither                -> leave surge_multiplier/surge_until exactly as is
  p_surge_multiplier  numeric default 1.00,
  p_surge_minutes     integer default null,
  p_clear_surge       boolean default false,
  p_note              text default null
)
returns public.service_zones
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_before public.service_zones;
  v_row    public.service_zones;
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_base_fee_centavos < 0 then
    raise exception 'base fee cannot be negative' using errcode = 'P0001';
  end if;
  if p_surge_minutes is not null and p_surge_multiplier <= 0 then
    raise exception 'surge multiplier must be positive' using errcode = 'P0001';
  end if;

  select * into v_before from public.service_zones where id = p_zone_id;
  if v_before.id is null then
    raise exception 'zone not found' using errcode = 'P0002';
  end if;

  update public.service_zones
  set is_active = p_is_active,
      base_fee_centavos = p_base_fee_centavos,
      surge_multiplier = case
        when p_surge_minutes is not null then p_surge_multiplier
        when p_clear_surge then 1
        else surge_multiplier
      end,
      surge_until = case
        when p_surge_minutes is not null then now() + make_interval(mins => p_surge_minutes)
        when p_clear_surge then null
        else surge_until
      end
  where id = p_zone_id
  returning * into v_row;

  insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(), 'update_zone', 'service_zones', p_zone_id::text,
    to_jsonb(v_before), to_jsonb(v_row), p_note
  );

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- add_to_cart - the one-cart-per-store rule, enforced server-side.
--
-- p_replace_cart makes the "you have items from another store, start a new
-- order?" prompt explicit instead of silently discarding a basket.
-- ----------------------------------------------------------------------------
create or replace function public.add_to_cart(
  p_menu_item_id uuid,
  p_quantity     integer default 1,
  p_option_ids   uuid[] default '{}',
  p_notes        text default null,
  p_replace_cart boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_item      public.menu_items;
  v_cart_id   uuid;
  v_item_id   uuid;
  v_other     uuid;
  v_option_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_item from public.menu_items where id = p_menu_item_id;
  if v_item.id is null or v_item.archived_at is not null or not v_item.is_available then
    raise exception 'item_unavailable' using errcode = 'P0001';
  end if;

  select id into v_other
  from public.carts
  where user_id = auth.uid() and merchant_id <> v_item.merchant_id
  limit 1;

  if v_other is not null then
    if not p_replace_cart then
      raise exception 'cart_belongs_to_another_store' using errcode = 'P0001';
    end if;
    delete from public.carts where user_id = auth.uid() and merchant_id <> v_item.merchant_id;
  end if;

  insert into public.carts (user_id, merchant_id)
  values (auth.uid(), v_item.merchant_id)
  on conflict (user_id, merchant_id) do update set updated_at = now()
  returning id into v_cart_id;

  insert into public.cart_items (cart_id, menu_item_id, quantity, notes)
  values (v_cart_id, p_menu_item_id, greatest(coalesce(p_quantity, 1), 1), p_notes)
  returning id into v_item_id;

  -- Only options that genuinely belong to this item are accepted. The same
  -- check runs again at checkout; doing it here just gives a better error.
  foreach v_option_id in array coalesce(p_option_ids, '{}')
  loop
    if not exists (
      select 1 from public.options o
      join public.option_groups og on og.id = o.option_group_id
      where o.id = v_option_id and og.menu_item_id = p_menu_item_id and o.is_available
    ) then
      raise exception 'option % does not belong to this item', v_option_id using errcode = 'P0001';
    end if;

    insert into public.cart_item_options (cart_item_id, option_id)
    values (v_item_id, v_option_id)
    on conflict do nothing;
  end loop;

  return v_cart_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- nearby_merchants - the discovery query.
--
-- Distance-ordered with the KNN operator so the GiST index does the work; the
-- alternative (compute st_distance for every store, then sort) degrades the
-- moment you have more than a few hundred merchants.
-- ----------------------------------------------------------------------------
create or replace function public.nearby_merchants(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m integer default 7000,
  p_search   text default null,
  p_limit    integer default 40,
  p_offset   integer default 0
)
returns table (
  id            uuid,
  slug          text,
  name          text,
  tagline       text,
  logo_url      text,
  cover_url     text,
  city          text,
  rating_avg    numeric,
  rating_count  integer,
  prep_time_minutes integer,
  min_order_centavos integer,
  distance_m    integer,
  is_open       boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_point extensions.geography :=
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
begin
  return query
  select m.id, m.slug::text, m.name, m.tagline, m.logo_url, m.cover_url, m.city,
         m.rating_avg, m.rating_count, m.prep_time_minutes, m.min_order_centavos,
         ceil(extensions.st_distance(m.location, v_point))::integer,
         public.is_merchant_open(m.id)
  from public.merchants m
  where m.status = 'approved'
    and m.location is not null
    and extensions.st_dwithin(m.location, v_point, p_radius_m)
    and (
      p_search is null or p_search = ''
      or m.name ilike '%' || p_search || '%'
      or exists (
        select 1 from public.menu_items mi
        where mi.merchant_id = m.id
          and mi.archived_at is null
          and mi.name ilike '%' || p_search || '%'
      )
    )
  order by m.location <-> v_point
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- order_tracking - everything the customer's tracking screen needs, in one
-- round trip.
--
-- It exposes the rider's first name, vehicle, plate and live position - and
-- nothing else. That is why profiles has no cross-user read policy: the exact
-- fields a customer needs are enumerated here rather than left to a join.
-- ----------------------------------------------------------------------------
create or replace function public.order_tracking(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_order  public.orders;
  v_rider  uuid;
  v_card   jsonb := null;
begin
  if not public.can_view_order(p_order_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  v_rider := public.current_rider_for_order(p_order_id);

  if v_rider is not null then
    select jsonb_build_object(
      'rider_id', r.id,
      -- First name only. The customer needs to recognise a person at the gate,
      -- not to be able to look them up afterwards.
      'first_name', split_part(coalesce(p.full_name, 'Your rider'), ' ', 1),
      'avatar_url', p.avatar_url,
      'vehicle', r.vehicle,
      'plate_number', r.plate_number,
      'rating_avg', r.rating_avg,
      'lat', extensions.st_y(r.current_location::extensions.geometry),
      'lng', extensions.st_x(r.current_location::extensions.geometry),
      'last_ping_at', r.last_ping_at
    )
    into v_card
    from public.riders r
    join public.profiles p on p.id = r.id
    where r.id = v_rider;
  end if;

  return jsonb_build_object(
    'order_id',     v_order.id,
    'code',         v_order.code,
    'status',       v_order.status,
    'type',         v_order.type,
    'placed_at',    v_order.placed_at,
    'promised_at',  v_order.promised_at,
    'eta_minutes',  v_order.eta_minutes,
    'total_centavos', v_order.total_centavos,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    -- The handover code is shown to the customer only, and only once a rider
    -- is actually carrying the food.
    'pod_code',     case when v_order.customer_id = auth.uid()
                              and v_order.status in ('picked_up', 'arrived')
                         then v_order.pod_code end,
    'merchant', (
      select jsonb_build_object('id', m.id, 'name', m.name, 'logo_url', m.logo_url,
                                'phone', m.phone,
                                'lat', extensions.st_y(m.location::extensions.geometry),
                                'lng', extensions.st_x(m.location::extensions.geometry))
      from public.merchants m where m.id = v_order.merchant_id
    ),
    'dropoff', jsonb_build_object(
      'address', v_order.delivery_address,
      'lat', extensions.st_y(v_order.dropoff_location::extensions.geometry),
      'lng', extensions.st_x(v_order.dropoff_location::extensions.geometry)
    ),
    'rider', v_card,
    'timeline', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'status', e.to_status, 'at', e.created_at, 'note', e.note
             ) order by e.created_at), '[]'::jsonb)
      from public.order_events e where e.order_id = p_order_id
    )
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- set_rider_availability - going online is a shift, not a flag. Keeping the
-- two in step in one function means payroll never has to guess.
-- ----------------------------------------------------------------------------
create or replace function public.set_rider_availability(
  p_online  boolean,
  p_zone_id uuid default null
)
returns public.riders
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rider public.riders;
begin
  select * into v_rider from public.riders where id = auth.uid() for update;

  if v_rider.id is null then
    raise exception 'not_a_rider' using errcode = '42501';
  end if;
  if p_online and not v_rider.is_verified then
    raise exception 'your account is still being verified' using errcode = 'P0001';
  end if;
  if p_online and v_rider.is_suspended then
    raise exception 'your account is suspended' using errcode = 'P0001';
  end if;

  -- Refusing to go offline mid-delivery is deliberate: the customer is
  -- watching a pin that would otherwise freeze with no explanation.
  if not p_online and v_rider.status in ('en_route_to_store', 'at_store', 'en_route_to_customer') then
    raise exception 'finish your current delivery before going offline' using errcode = 'P0001';
  end if;

  update public.riders
  set status = (case when p_online then 'online_idle' else 'offline' end)::public.rider_status,
      home_zone_id = coalesce(p_zone_id, home_zone_id),
      last_ping_at = case when p_online then now() else last_ping_at end
  where id = auth.uid()
  returning * into v_rider;

  if p_online then
    insert into public.rider_shifts (rider_id, zone_id)
    values (auth.uid(), coalesce(p_zone_id, v_rider.home_zone_id))
    on conflict do nothing;
  else
    update public.rider_shifts
    set ended_at = now()
    where rider_id = auth.uid() and ended_at is null;
  end if;

  return v_rider;
end;
$$;

-- ----------------------------------------------------------------------------
-- merchant_stats - the numbers on the merchant dashboard, computed in one
-- query rather than six round trips from the client.
-- ----------------------------------------------------------------------------
create or replace function public.merchant_stats(
  p_merchant_id uuid,
  p_from        timestamptz default (now() - interval '7 days'),
  p_to          timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_merchant_member(p_merchant_id) or public.is_admin()) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'orders_count',        count(*) filter (where status = 'delivered'),
      'gross_centavos',      coalesce(sum(subtotal_centavos) filter (where status = 'delivered'), 0),
      'commission_centavos', coalesce(sum(platform_commission_centavos) filter (where status = 'delivered'), 0),
      'payout_centavos',     coalesce(sum(merchant_payout_centavos) filter (where status = 'delivered'), 0),
      'cancelled_count',     count(*) filter (where status = 'cancelled'),
      -- Acceptance rate and median prep time are the two numbers that predict
      -- whether a store is about to start generating complaints.
      'acceptance_rate', round(
        coalesce(
          count(*) filter (where accepted_at is not null)::numeric
          / nullif(count(*) filter (where placed_at is not null), 0), 0
        ), 3),
      'median_prep_minutes', coalesce(
        percentile_cont(0.5) within group (
          order by extract(epoch from (ready_at - accepted_at)) / 60.0
        ) filter (where ready_at is not null and accepted_at is not null), 0)
    )
    from public.orders
    where merchant_id = p_merchant_id
      and created_at between p_from and p_to
  );
end;
$$;

grant execute on function public.create_merchant(text, text, text) to authenticated;
grant execute on function public.add_to_cart(uuid, integer, uuid[], text, boolean) to authenticated;
grant execute on function public.nearby_merchants(double precision, double precision, integer, text, integer, integer) to anon, authenticated;
grant execute on function public.order_tracking(uuid) to authenticated;
grant execute on function public.set_rider_availability(boolean, uuid) to authenticated;
grant execute on function public.merchant_stats(uuid, timestamptz, timestamptz) to authenticated;
