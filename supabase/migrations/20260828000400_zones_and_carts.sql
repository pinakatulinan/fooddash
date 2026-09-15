-- ============================================================================
-- 0004  Service zones and server-side carts
-- ----------------------------------------------------------------------------
-- The cart lives in the database, not in localStorage. Three reasons:
-- it survives a device switch mid-order, it lets ops see abandoned carts, and
-- it means checkout re-prices from rows the server already owns rather than
-- from a payload the client composed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- service_zones - the polygons you actually operate in. Launching city by city
-- means "are we live here" has to be a data question, not a code change.
-- ----------------------------------------------------------------------------
create table public.service_zones (
  id                   uuid primary key default extensions.gen_random_uuid(),
  name                 text not null,
  city                 text not null,
  area                 extensions.geography(polygon, 4326) not null,
  is_active            boolean not null default true,

  -- Delivery fee formula: base covers everything up to base_distance_m,
  -- then per_km applies, and the result is clamped to max_fee.
  base_fee_centavos    integer not null default 4900,
  base_distance_m      integer not null default 2000,
  per_km_fee_centavos  integer not null default 1200,
  max_fee_centavos     integer not null default 20000,
  max_distance_m       integer not null default 8000,

  -- Surge, set by ops during rain or rider shortage. 1.00 = no surge.
  surge_multiplier     numeric(4, 2) not null default 1.00,
  surge_until          timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint service_zones_surge_range check (surge_multiplier between 1.00 and 5.00),
  constraint service_zones_fee_range check (max_fee_centavos >= base_fee_centavos)
);

create index service_zones_area_idx on public.service_zones using gist (area);
create index service_zones_active_idx on public.service_zones (city) where is_active;

create trigger service_zones_touch before update on public.service_zones
  for each row execute function public.touch_updated_at();

-- Which zone contains this point? Null means we do not deliver there yet.
create or replace function public.zone_for_point(p_point extensions.geography)
returns public.service_zones
language sql
stable
security definer
set search_path = public, extensions
as $$
  select z.*
  from public.service_zones z
  where z.is_active
    and extensions.st_covers(z.area, p_point)
  order by extensions.st_area(z.area::extensions.geometry) asc
  limit 1;
$$;

comment on function public.zone_for_point is
  'Smallest active zone covering the point, so a dense city zone wins over a broad provincial one.';

-- ----------------------------------------------------------------------------
-- quote_delivery - the one place a delivery fee is ever computed.
-- Returns the fee plus the inputs that produced it, so a disputed charge can
-- be explained months later from the order record alone.
-- ----------------------------------------------------------------------------
create or replace function public.quote_delivery(
  p_merchant_id uuid,
  p_dropoff     extensions.geography
)
returns table (
  zone_id        uuid,
  distance_m     integer,
  fee_centavos   integer,
  surge_applied  numeric,
  eta_minutes    integer,
  deliverable    boolean,
  reason         text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_merchant public.merchants;
  v_zone     public.service_zones;
  v_distance integer;
  v_fee      numeric;
  v_surge    numeric := 1.00;
begin
  select * into v_merchant from public.merchants where id = p_merchant_id;

  if v_merchant.id is null or v_merchant.location is null then
    return query select null::uuid, null::integer, null::integer, null::numeric,
                        null::integer, false, 'merchant_not_locatable';
    return;
  end if;

  v_distance := ceil(extensions.st_distance(v_merchant.location, p_dropoff))::integer;

  if v_distance > v_merchant.delivery_radius_m then
    return query select null::uuid, v_distance, null::integer, null::numeric,
                        null::integer, false, 'outside_merchant_radius';
    return;
  end if;

  select * into v_zone from public.zone_for_point(p_dropoff);

  if v_zone.id is null then
    return query select null::uuid, v_distance, null::integer, null::numeric,
                        null::integer, false, 'outside_service_area';
    return;
  end if;

  if v_distance > v_zone.max_distance_m then
    return query select v_zone.id, v_distance, null::integer, null::numeric,
                        null::integer, false, 'too_far_for_zone';
    return;
  end if;

  v_fee := v_zone.base_fee_centavos;

  if v_distance > v_zone.base_distance_m then
    v_fee := v_fee
      + ((v_distance - v_zone.base_distance_m)::numeric / 1000.0) * v_zone.per_km_fee_centavos;
  end if;

  if v_zone.surge_until is not null and v_zone.surge_until > now() then
    v_surge := v_zone.surge_multiplier;
    v_fee := v_fee * v_surge;
  end if;

  v_fee := least(round(v_fee), v_zone.max_fee_centavos);

  return query select
    v_zone.id,
    v_distance,
    v_fee::integer,
    v_surge,
    -- Prep time plus travel at a deliberately pessimistic 18 km/h city average,
    -- plus 5 minutes of handover slack. Under-promising is cheaper than
    -- refunding a late order.
    (v_merchant.prep_time_minutes + ceil((v_distance::numeric / 1000.0) / 18.0 * 60.0) + 5)::integer,
    true,
    null::text;
end;
$$;

-- ----------------------------------------------------------------------------
-- carts - exactly one open cart per (customer, merchant).
--
-- Deliberate product rule: a cart cannot span two stores. Multi-store baskets
-- multiply delivery legs, prep timings, and partial-cancellation cases, and
-- they are the single fastest way to make early operations unmanageable.
-- ----------------------------------------------------------------------------
create table public.carts (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, merchant_id)
);

create index carts_user_idx on public.carts (user_id, updated_at desc);

create trigger carts_touch before update on public.carts
  for each row execute function public.touch_updated_at();

create table public.cart_items (
  id           uuid primary key default extensions.gen_random_uuid(),
  cart_id      uuid not null references public.carts(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  quantity     integer not null default 1,
  notes        text,
  created_at   timestamptz not null default now(),

  constraint cart_items_quantity_range check (quantity between 1 and 99)
);

create index cart_items_cart_idx on public.cart_items (cart_id);

-- No prices here on purpose. The cart stores *what was chosen*; the money is
-- recomputed from the live menu at checkout by place_order() in 0008.
create table public.cart_item_options (
  cart_item_id uuid not null references public.cart_items(id) on delete cascade,
  option_id    uuid not null references public.options(id) on delete cascade,
  primary key (cart_item_id, option_id)
);

-- Touch the parent cart whenever its contents change, so "abandoned for 2 days"
-- queries and realtime subscriptions both see a meaningful updated_at.
create or replace function public.touch_parent_cart()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cart_id uuid;
begin
  v_cart_id := coalesce(new.cart_id, old.cart_id);
  update public.carts set updated_at = now() where id = v_cart_id;
  return coalesce(new, old);
end;
$$;

create trigger cart_items_touch_parent
  after insert or update or delete on public.cart_items
  for each row execute function public.touch_parent_cart();
