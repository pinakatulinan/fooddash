-- ============================================================================
-- GENERATED FILE - do not edit, and do not add to supabase/migrations/.
--
-- All migrations concatenated in order, for one-shot execution in the
-- Supabase SQL editor when the CLI is not available. Regenerate with:
--   cat supabase/migrations/*.sql > supabase/_bootstrap.sql
--
-- Run this ONCE on an empty project. It is not idempotent.
-- ============================================================================


-- >>> 20260828000100_extensions_and_enums.sql

-- ============================================================================
-- 0001  Extensions and enums
-- ----------------------------------------------------------------------------
-- Everything downstream depends on this file. Enums are used instead of text
-- columns so that an invalid state is impossible to write, not merely unusual.
-- ============================================================================

create extension if not exists "uuid-ossp"  with schema extensions;
create extension if not exists "pgcrypto"   with schema extensions;
create extension if not exists "postgis"    with schema extensions;
create extension if not exists "citext"     with schema extensions;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

-- A person's platform-level role. Merchant staff membership is modelled
-- separately in merchant_members, because one user may work for many stores.
create type public.user_role as enum (
  'customer',
  'merchant',
  'rider',
  'support',
  'admin'
);

create type public.merchant_status as enum (
  'draft',           -- owner is still filling in the profile
  'pending_review',  -- submitted, waiting on ops
  'approved',        -- live and orderable
  'suspended',       -- temporarily hidden by ops
  'rejected'
);

-- The order lifecycle. Transitions are enforced by a trigger in 0008.
create type public.order_status as enum (
  'draft',
  'pending_payment',   -- online payment initiated, awaiting provider confirmation
  'placed',            -- paid or COD-confirmed, waiting on the merchant
  'accepted',          -- merchant confirmed, prep clock started
  'preparing',
  'ready_for_pickup',
  'picked_up',         -- rider has the food
  'arrived',           -- rider at the customer's address
  'delivered',
  'cancelled',
  'failed'             -- undeliverable: nobody home, wrong address, rider incident
);

create type public.order_type as enum ('delivery', 'pickup');

create type public.payment_method as enum ('cod', 'gcash', 'maya', 'card');

create type public.payment_status as enum (
  'pending',
  'authorized',
  'paid',
  'failed',
  'refunded',
  'partially_refunded'
);

-- Rider availability. Only 'online_idle' riders are eligible for new offers.
create type public.rider_status as enum (
  'offline',
  'online_idle',
  'on_offer',              -- has a pending offer, not yet answered
  'en_route_to_store',
  'at_store',
  'en_route_to_customer',
  'unavailable'            -- online but blocked (break, cash cap reached)
);

create type public.assignment_status as enum (
  'offered',
  'accepted',
  'declined',
  'expired',
  'cancelled',
  'completed'
);

-- Manual = ops assigns by hand. Auto = nearest-rider offer loop.
-- Stored in platform_settings so it flips without a deploy.
create type public.dispatch_mode as enum ('manual', 'auto');

create type public.vehicle_type as enum ('motorcycle', 'bicycle', 'car', 'on_foot');

create type public.promo_type as enum ('percent_off', 'fixed_off', 'free_delivery');

-- Who absorbs the cost of a discount. Drives the payout maths.
create type public.promo_funder as enum ('platform', 'merchant', 'shared');

create type public.ledger_account_type as enum ('platform', 'merchant', 'rider', 'customer');

create type public.ledger_entry_type as enum (
  'order_sale',           -- gross value of the basket, credited to the merchant
  'platform_commission',  -- platform's cut, debited from the merchant
  'delivery_fee',         -- what the customer paid for delivery
  'rider_earning',        -- credited to the rider
  'tip',
  'promo_subsidy',        -- who ate the discount
  'refund',
  'adjustment',           -- manual correction by ops, always needs a note
  'cash_collected',       -- COD: rider now owes the platform this money
  'cash_remitted',        -- COD: rider handed it in
  'payout'
);

create type public.payout_status as enum ('scheduled', 'processing', 'paid', 'failed', 'on_hold');

create type public.document_status as enum ('pending', 'approved', 'rejected', 'expired');

create type public.ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');

-- ----------------------------------------------------------------------------
-- The one trigger function that has no table dependencies, so it can live here
-- and be attached by every table that follows.
-- ----------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- >>> 20260828000200_identity.sql

-- ============================================================================
-- 0002  Identity: profiles, addresses, notifications, platform settings
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles - one row per auth.users row, created automatically on signup.
-- auth.users is owned by Supabase and cannot carry app columns, so every
-- application-level fact about a person lives here.
-- ----------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  role              public.user_role not null default 'customer',
  full_name         text,
  phone             text,
  email             extensions.citext,
  avatar_url        text,
  -- PH mobile numbers are the real identity here; email is often secondary.
  phone_verified_at timestamptz,
  is_blocked        boolean not null default false,
  blocked_reason    text,
  locale            text not null default 'en-PH',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint profiles_phone_format check (
    phone is null or phone ~ '^\+63[0-9]{10}$'
  )
);

create unique index profiles_phone_key on public.profiles (phone) where phone is not null;
create index profiles_role_idx on public.profiles (role);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

comment on column public.profiles.role is
  'Platform-level role. Merchant staff membership is separate (merchant_members) because one user can work for several stores.';

-- Mirror new auth users into profiles. Runs as definer because the trigger
-- fires in the auth schema where the caller has no rights on public.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    -- The client may request a role at signup, but only these three are
    -- self-serve. 'admin' and 'support' are granted by an existing admin only.
    case new.raw_user_meta_data ->> 'role'
      when 'merchant' then 'merchant'::public.user_role
      when 'rider'    then 'rider'::public.user_role
      else 'customer'::public.user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- addresses - saved customer delivery addresses.
--
-- PH addresses are unreliable as free text, so the map pin is the source of
-- truth for routing and the text is what the rider reads. `landmark` is not
-- decoration: it is how riders actually find the door.
-- ----------------------------------------------------------------------------
create table public.addresses (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  label           text not null default 'Home',
  recipient_name  text,
  recipient_phone text,
  line1           text not null,
  barangay        text,
  city            text not null,
  province        text,
  postal_code     text,
  landmark        text,
  delivery_notes  text,
  location        extensions.geography(point, 4326) not null,
  is_default      boolean not null default false,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index addresses_user_idx on public.addresses (user_id) where archived_at is null;
create index addresses_location_idx on public.addresses using gist (location);
-- At most one default per user, enforced by the database rather than by hope.
create unique index addresses_one_default_per_user
  on public.addresses (user_id) where is_default and archived_at is null;

create trigger addresses_touch before update on public.addresses
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- notifications - in-app inbox. Push delivery is a separate concern handled by
-- an Edge Function reading push_subscriptions.
-- ----------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc) where read_at is null;

create table public.push_subscriptions (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth_key   text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- platform_settings - operational knobs that must change without a deploy:
-- dispatch mode, fee formula, offer timeout, COD cash caps.
-- ----------------------------------------------------------------------------
create table public.platform_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);

create trigger platform_settings_touch before update on public.platform_settings
  for each row execute function public.touch_updated_at();

insert into public.platform_settings (key, value, description) values
  ('dispatch_mode', '"manual"'::jsonb,
   'manual = ops assigns riders by hand; auto = nearest-rider offer loop. Start manual.'),
  ('dispatch_offer_seconds', '45'::jsonb,
   'How long a rider has to accept an offer before it expires and moves to the next.'),
  ('dispatch_search_radius_m', '5000'::jsonb,
   'Maximum straight-line distance from the store when looking for riders.'),
  ('default_commission_rate', '0.15'::jsonb,
   'Platform cut of the food subtotal for new merchants (15%).'),
  ('service_fee_rate', '0.00'::jsonb,
   'Customer-facing platform fee. Zero at launch: small merchants need volume first.'),
  ('rider_cash_cap_centavos', '300000'::jsonb,
   'COD cash a rider may hold (PHP 3,000.00) before being blocked from new orders.'),
  ('currency', '"PHP"'::jsonb,
   'ISO code. All monetary amounts in this schema are integer centavos.'),
  ('accepting_signups', 'true'::jsonb,
   'Global kill switch for new merchant and rider signups.');

-- ----------------------------------------------------------------------------
-- admin_audit_log - every privileged action. Append-only by policy; there is
-- deliberately no UPDATE or DELETE policy for anyone, including admins.
-- ----------------------------------------------------------------------------
create table public.admin_audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles(id),
  action      text not null,
  entity_type text not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  note        text,
  created_at  timestamptz not null default now()
);

create index admin_audit_log_entity_idx
  on public.admin_audit_log (entity_type, entity_id, created_at desc);

-- >>> 20260828000300_merchants_and_menu.sql

-- ============================================================================
-- 0003  Merchants, staff, opening hours, and the menu tree
-- ----------------------------------------------------------------------------
-- The menu is a three-level tree: category -> item -> option group -> option.
-- Prices live at the item (base) and the option (delta). Nothing else is
-- allowed to hold a price, so there is exactly one place to look when a total
-- is wrong.
-- ============================================================================

create table public.merchants (
  id                 uuid primary key default extensions.gen_random_uuid(),
  slug               extensions.citext not null unique,
  name               text not null,
  tagline            text,
  description        text,
  logo_url           text,
  cover_url          text,
  phone              text,
  email              extensions.citext,
  status             public.merchant_status not null default 'draft',
  rejection_reason   text,

  -- Storefront address. location drives every distance calculation.
  line1              text,
  barangay           text,
  city               text,
  province           text,
  postal_code        text,
  location           extensions.geography(point, 4326),

  -- Commercial terms, per merchant so ops can negotiate individually.
  commission_rate    numeric(5, 4) not null default 0.1500,
  min_order_centavos integer not null default 0,
  prep_time_minutes  integer not null default 20,
  delivery_radius_m  integer not null default 5000,

  -- The panic button. Distinct from status: the store is approved and listed,
  -- it just cannot take orders right now (kitchen slammed, brownout, no stock).
  is_accepting_orders boolean not null default false,
  paused_until        timestamptz,
  pause_reason        text,

  -- Denormalised rating, maintained by trigger in 0006. Reading it costs
  -- nothing; recomputing an average over every review on each store card
  -- would be the first thing to fall over.
  rating_avg         numeric(3, 2) not null default 0,
  rating_count       integer not null default 0,

  -- Payout destination. Account numbers are never exposed to the client:
  -- RLS keeps this table owner-only and the payout runner uses the service key.
  payout_method      text,
  payout_account_name text,
  payout_account_number text,

  approved_at        timestamptz,
  approved_by        uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint merchants_commission_range check (commission_rate >= 0 and commission_rate <= 1),
  constraint merchants_prep_time_sane check (prep_time_minutes between 1 and 240),
  constraint merchants_min_order_nonneg check (min_order_centavos >= 0),
  -- An approved store must be locatable, or discovery silently drops it.
  constraint merchants_approved_needs_location check (
    status <> 'approved' or location is not null
  )
);

create index merchants_status_idx on public.merchants (status);
create index merchants_location_idx on public.merchants using gist (location);
create index merchants_live_idx on public.merchants (city)
  where status = 'approved' and is_accepting_orders;

create trigger merchants_touch before update on public.merchants
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- merchant_members - who may act for a store. A cashier gets order access
-- without the ability to change prices or see payout details.
-- ----------------------------------------------------------------------------
create table public.merchant_members (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  is_owner    boolean not null default false,
  can_manage_menu   boolean not null default true,
  can_manage_orders boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (merchant_id, user_id)
);

create index merchant_members_user_idx on public.merchant_members (user_id);

-- ----------------------------------------------------------------------------
-- merchant_documents - business permit, BIR registration, sanitary permit, IDs.
-- expires_at exists because permits lapse and ops must be warned before a
-- store is quietly operating on an expired permit.
-- ----------------------------------------------------------------------------
create table public.merchant_documents (
  id           uuid primary key default extensions.gen_random_uuid(),
  merchant_id  uuid not null references public.merchants(id) on delete cascade,
  doc_type     text not null,
  storage_path text not null,
  status       public.document_status not null default 'pending',
  review_note  text,
  expires_at   date,
  reviewed_by  uuid references public.profiles(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index merchant_documents_merchant_idx on public.merchant_documents (merchant_id);
create index merchant_documents_expiry_idx on public.merchant_documents (expires_at)
  where status = 'approved';

-- ----------------------------------------------------------------------------
-- Opening hours. Two tables on purpose:
--   merchant_hours    - the recurring weekly pattern
--   merchant_closures - dated overrides (holidays, fiestas, emergency closure)
-- A store is open when a matching hours row exists and no closure covers now().
-- ----------------------------------------------------------------------------
create table public.merchant_hours (
  id          uuid primary key default extensions.gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  -- 0 = Sunday, matching Postgres extract(dow).
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opens_at    time not null,
  closes_at   time not null,
  -- Stores that close after midnight (2am closing) set this instead of trying
  -- to encode a time range that wraps.
  closes_next_day boolean not null default false,
  created_at  timestamptz not null default now(),

  constraint merchant_hours_range check (closes_next_day or closes_at > opens_at)
);

create index merchant_hours_merchant_idx on public.merchant_hours (merchant_id, day_of_week);

create table public.merchant_closures (
  id          uuid primary key default extensions.gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text,
  created_at  timestamptz not null default now(),
  constraint merchant_closures_range check (ends_at > starts_at)
);

create index merchant_closures_merchant_idx on public.merchant_closures (merchant_id, starts_at, ends_at);

-- ----------------------------------------------------------------------------
-- Menu tree
-- ----------------------------------------------------------------------------
create table public.menu_categories (
  id          uuid primary key default extensions.gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  name        text not null,
  description text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index menu_categories_merchant_idx on public.menu_categories (merchant_id, sort_order);

create trigger menu_categories_touch before update on public.menu_categories
  for each row execute function public.touch_updated_at();

create table public.menu_items (
  id                uuid primary key default extensions.gen_random_uuid(),
  merchant_id       uuid not null references public.merchants(id) on delete cascade,
  category_id       uuid references public.menu_categories(id) on delete set null,
  name              text not null,
  description       text,
  image_url         text,
  base_price_centavos integer not null,
  -- is_available is the daily "86 this item" toggle. Deleting a menu item is
  -- never correct: past orders reference it.
  is_available      boolean not null default true,
  -- Set by the merchant when an item sells out; cleared automatically at the
  -- next opening so nobody has to remember to un-86 it.
  unavailable_until timestamptz,
  prep_time_minutes integer,
  is_popular        boolean not null default false,
  sort_order        integer not null default 0,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint menu_items_price_nonneg check (base_price_centavos >= 0)
);

create index menu_items_merchant_idx on public.menu_items (merchant_id) where archived_at is null;
create index menu_items_category_idx on public.menu_items (category_id, sort_order) where archived_at is null;

create trigger menu_items_touch before update on public.menu_items
  for each row execute function public.touch_updated_at();

-- Option groups: "Size" (pick exactly 1), "Add-ons" (pick up to 3).
-- min_select/max_select are validated server-side at checkout in 0008 - the
-- client renders them, but is never trusted to have obeyed them.
create table public.option_groups (
  id            uuid primary key default extensions.gen_random_uuid(),
  menu_item_id  uuid not null references public.menu_items(id) on delete cascade,
  name          text not null,
  min_select    smallint not null default 0,
  max_select    smallint not null default 1,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),

  constraint option_groups_select_range check (min_select >= 0 and max_select >= min_select)
);

create index option_groups_item_idx on public.option_groups (menu_item_id, sort_order);

create table public.options (
  id                  uuid primary key default extensions.gen_random_uuid(),
  option_group_id     uuid not null references public.option_groups(id) on delete cascade,
  name                text not null,
  -- May be negative (a discount for skipping rice) but usually zero or more.
  price_delta_centavos integer not null default 0,
  is_available        boolean not null default true,
  is_default          boolean not null default false,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now()
);

create index options_group_idx on public.options (option_group_id, sort_order);

-- ----------------------------------------------------------------------------
-- is_merchant_open - the single answer to "can I order from this store right
-- now", used by discovery, the store page, and checkout validation alike.
-- ----------------------------------------------------------------------------
create or replace function public.is_merchant_open(
  p_merchant_id uuid,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_merchant public.merchants;
  v_local    timestamp;
  v_dow      smallint;
  v_time     time;
begin
  select * into v_merchant from public.merchants where id = p_merchant_id;

  if v_merchant.id is null
     or v_merchant.status <> 'approved'
     or not v_merchant.is_accepting_orders then
    return false;
  end if;

  if v_merchant.paused_until is not null and v_merchant.paused_until > p_at then
    return false;
  end if;

  if exists (
    select 1 from public.merchant_closures c
    where c.merchant_id = p_merchant_id
      and p_at between c.starts_at and c.ends_at
  ) then
    return false;
  end if;

  -- All trading hours are expressed in Philippine local time.
  v_local := p_at at time zone 'Asia/Manila';
  v_dow   := extract(dow from v_local)::smallint;
  v_time  := v_local::time;

  return exists (
    select 1 from public.merchant_hours h
    where h.merchant_id = p_merchant_id
      and (
        -- Same-day window.
        (h.day_of_week = v_dow and not h.closes_next_day and v_time between h.opens_at and h.closes_at)
        -- Window that opened today and runs past midnight.
        or (h.day_of_week = v_dow and h.closes_next_day and v_time >= h.opens_at)
        -- Tail of a window that opened yesterday.
        or (h.day_of_week = (v_dow + 6) % 7 and h.closes_next_day and v_time < h.closes_at)
      )
  );
end;
$$;

-- >>> 20260828000400_zones_and_carts.sql

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

-- >>> 20260828000500_orders.sql

-- ============================================================================
-- 0005  Orders
-- ----------------------------------------------------------------------------
-- Every order carries a full snapshot: item names, unit prices, the delivery
-- address, the fee breakdown. Menus change and addresses get deleted; a
-- three-month-old receipt must still render exactly as the customer saw it.
-- Joining live menu rows to display an old order is a bug, not an optimisation.
-- ============================================================================

create table public.orders (
  id            uuid primary key default extensions.gen_random_uuid(),
  -- Short human code for support calls and rider handover. Not the PK.
  code          text not null unique,

  customer_id   uuid not null references public.profiles(id) on delete restrict,
  merchant_id   uuid not null references public.merchants(id) on delete restrict,

  type          public.order_type not null default 'delivery',
  status        public.order_status not null default 'draft',

  -- Delivery target, snapshotted. address_id is kept for convenience but the
  -- jsonb is what gets displayed and what the rider navigates to.
  address_id       uuid references public.addresses(id) on delete set null,
  delivery_address jsonb,
  dropoff_location extensions.geography(point, 4326),
  zone_id          uuid references public.service_zones(id),

  -- --- Money. Every column is integer centavos. Never floats, never numeric
  -- --- for currency: a rounding difference in a payout is a support ticket.
  subtotal_centavos      integer not null default 0,
  delivery_fee_centavos  integer not null default 0,
  service_fee_centavos   integer not null default 0,
  discount_centavos      integer not null default 0,
  tip_centavos           integer not null default 0,
  total_centavos         integer not null default 0,

  -- Settlement split, frozen at placement so a later commission-rate change
  -- cannot retroactively alter what a merchant is owed.
  commission_rate_applied numeric(5, 4) not null default 0,
  platform_commission_centavos integer not null default 0,
  merchant_payout_centavos     integer not null default 0,
  rider_earning_centavos       integer not null default 0,

  payment_method public.payment_method not null default 'cod',
  payment_status public.payment_status not null default 'pending',

  promo_id      uuid,
  promo_code    text,

  -- Timing
  scheduled_for timestamptz,
  distance_m    integer,
  eta_minutes   integer,
  promised_at   timestamptz,

  placed_at     timestamptz,
  accepted_at   timestamptz,
  ready_at      timestamptz,
  picked_up_at  timestamptz,
  delivered_at  timestamptz,
  cancelled_at  timestamptz,

  cancelled_by       uuid references public.profiles(id),
  cancellation_reason text,
  failure_reason      text,

  customer_notes text,
  -- Proof of delivery: photo path in storage, or a short OTP the customer reads
  -- out. Which one is required is an ops policy, not a schema decision.
  pod_photo_path text,
  pod_code       text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint orders_amounts_nonneg check (
    subtotal_centavos >= 0 and delivery_fee_centavos >= 0 and service_fee_centavos >= 0
    and discount_centavos >= 0 and tip_centavos >= 0 and total_centavos >= 0
  ),
  -- The invariant that protects revenue. If any code path ever computes a
  -- total that does not reconcile, the write fails loudly instead of quietly
  -- charging the wrong amount.
  constraint orders_total_reconciles check (
    total_centavos = subtotal_centavos + delivery_fee_centavos + service_fee_centavos
                     + tip_centavos - discount_centavos
  ),
  constraint orders_delivery_needs_address check (
    type <> 'delivery' or status = 'draft' or delivery_address is not null
  )
);

create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_merchant_idx on public.orders (merchant_id, created_at desc);
-- The merchant order console and the ops board both read live orders only;
-- a partial index keeps those queries flat as history grows.
create index orders_merchant_live_idx on public.orders (merchant_id, status)
  where status in ('placed', 'accepted', 'preparing', 'ready_for_pickup', 'picked_up', 'arrived');
create index orders_dispatch_queue_idx on public.orders (created_at)
  where status in ('accepted', 'preparing', 'ready_for_pickup');
create index orders_dropoff_idx on public.orders using gist (dropoff_location);
create index orders_code_idx on public.orders (code);

create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Order code: FD-XXXXXX from an unambiguous alphabet (no O/0, I/1, S/5) so it
-- survives being read aloud over a bad phone line.
-- ----------------------------------------------------------------------------
create or replace function public.generate_order_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRTUVWXYZ';
  v_code text;
  v_try  integer := 0;
begin
  loop
    v_code := 'FD-';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    end loop;

    exit when not exists (select 1 from public.orders where code = v_code);

    v_try := v_try + 1;
    if v_try > 20 then
      raise exception 'could not allocate a unique order code after % attempts', v_try;
    end if;
  end loop;

  return v_code;
end;
$$;

-- ----------------------------------------------------------------------------
-- order_items - snapshotted line items.
-- ----------------------------------------------------------------------------
create table public.order_items (
  id            uuid primary key default extensions.gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  -- Nullable and ON DELETE SET NULL: the menu item may be archived later, but
  -- the line must survive with its snapshot intact.
  menu_item_id  uuid references public.menu_items(id) on delete set null,
  name_snapshot text not null,
  image_url_snapshot text,
  unit_price_centavos integer not null,  -- base + selected option deltas
  quantity      integer not null,
  line_total_centavos integer not null,  -- unit_price * quantity
  notes         text,
  created_at    timestamptz not null default now(),

  constraint order_items_quantity_range check (quantity between 1 and 99),
  constraint order_items_line_total_reconciles check (
    line_total_centavos = unit_price_centavos * quantity
  )
);

create index order_items_order_idx on public.order_items (order_id);

create table public.order_item_options (
  id             uuid primary key default extensions.gen_random_uuid(),
  order_item_id  uuid not null references public.order_items(id) on delete cascade,
  option_id      uuid references public.options(id) on delete set null,
  group_name_snapshot text not null,
  name_snapshot  text not null,
  price_delta_centavos integer not null default 0
);

create index order_item_options_item_idx on public.order_item_options (order_item_id);

-- ----------------------------------------------------------------------------
-- order_events - append-only audit trail of every status change.
--
-- This is what powers the customer tracking timeline, the merchant's "you
-- accepted this at 6:42pm" defence in a dispute, and every operational metric
-- (acceptance time, prep time, time-to-pickup) without extra instrumentation.
-- ----------------------------------------------------------------------------
create table public.order_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  actor_id    uuid references public.profiles(id),
  actor_role  public.user_role,
  note        text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id, created_at);

-- ----------------------------------------------------------------------------
-- reviews - one per order, rating both the food and the ride separately
-- because they are different businesses failing in different ways.
-- ----------------------------------------------------------------------------
create table public.reviews (
  id              uuid primary key default extensions.gen_random_uuid(),
  order_id        uuid not null unique references public.orders(id) on delete cascade,
  customer_id     uuid not null references public.profiles(id) on delete cascade,
  merchant_id     uuid not null references public.merchants(id) on delete cascade,
  rider_id        uuid references public.profiles(id) on delete set null,
  merchant_rating smallint check (merchant_rating between 1 and 5),
  rider_rating    smallint check (rider_rating between 1 and 5),
  comment         text,
  -- Ops can hide a review that is abusive or names a person, without deleting
  -- evidence that may matter in a dispute.
  is_hidden       boolean not null default false,
  hidden_reason   text,
  created_at      timestamptz not null default now()
);

create index reviews_merchant_idx on public.reviews (merchant_id, created_at desc) where not is_hidden;

-- Keep merchants.rating_avg in step with reviews. Recomputing the aggregate
-- for one merchant on write is cheap; recomputing it for every store card on
-- every discovery page load is not.
create or replace function public.refresh_merchant_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant_id uuid := coalesce(new.merchant_id, old.merchant_id);
begin
  update public.merchants m
  set rating_avg = coalesce(agg.avg_rating, 0),
      rating_count = coalesce(agg.n, 0)
  from (
    select avg(merchant_rating)::numeric(3, 2) as avg_rating, count(*) as n
    from public.reviews
    where merchant_id = v_merchant_id
      and merchant_rating is not null
      and not is_hidden
  ) agg
  where m.id = v_merchant_id;

  return coalesce(new, old);
end;
$$;

create trigger reviews_refresh_rating
  after insert or update or delete on public.reviews
  for each row execute function public.refresh_merchant_rating();

-- >>> 20260828000600_riders_and_dispatch.sql

-- ============================================================================
-- 0006  Riders and dispatch
-- ----------------------------------------------------------------------------
-- Dispatch is modelled as offers, not assignments. An order is *offered* to a
-- rider who may accept, decline, or let it expire; only an accepted offer
-- binds. That shape supports manual ops assignment and an automatic
-- nearest-rider loop with the same table, which is what lets you start with a
-- human dispatcher and switch on the algorithm later without a migration.
-- ============================================================================

create table public.riders (
  id                uuid primary key references public.profiles(id) on delete cascade,
  vehicle           public.vehicle_type not null default 'motorcycle',
  plate_number      text,
  status            public.rider_status not null default 'offline',

  -- Ops gate. A rider may be signed up and still not dispatchable.
  is_verified       boolean not null default false,
  verified_at       timestamptz,
  verified_by       uuid references public.profiles(id),
  is_suspended      boolean not null default false,
  suspension_reason text,

  home_zone_id      uuid references public.service_zones(id),
  current_location  extensions.geography(point, 4326),
  last_ping_at      timestamptz,

  -- COD float. The rider is holding the platform's money between collection
  -- and remittance; past the cap they stop receiving cash orders.
  cash_on_hand_centavos integer not null default 0,

  rating_avg        numeric(3, 2) not null default 0,
  rating_count      integer not null default 0,
  completed_deliveries integer not null default 0,
  cancelled_deliveries integer not null default 0,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index riders_location_idx on public.riders using gist (current_location);
-- The dispatch hot path: verified, idle, recently seen. Kept as a partial
-- index so the candidate scan touches only genuinely dispatchable riders.
create index riders_dispatchable_idx on public.riders (status, last_ping_at)
  where is_verified and not is_suspended and status = 'online_idle';

create trigger riders_touch before update on public.riders
  for each row execute function public.touch_updated_at();

create table public.rider_documents (
  id           uuid primary key default extensions.gen_random_uuid(),
  rider_id     uuid not null references public.riders(id) on delete cascade,
  doc_type     text not null,   -- drivers_license, or_cr, nbi_clearance, selfie_id
  storage_path text not null,
  status       public.document_status not null default 'pending',
  review_note  text,
  expires_at   date,
  reviewed_by  uuid references public.profiles(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index rider_documents_rider_idx on public.rider_documents (rider_id);
create index rider_documents_expiry_idx on public.rider_documents (expires_at)
  where status = 'approved';

-- ----------------------------------------------------------------------------
-- rider_shifts - when a rider declared themselves available. Payroll,
-- incentives, and "why was nobody online at 7pm" all read this.
-- ----------------------------------------------------------------------------
create table public.rider_shifts (
  id         uuid primary key default extensions.gen_random_uuid(),
  rider_id   uuid not null references public.riders(id) on delete cascade,
  zone_id    uuid references public.service_zones(id),
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  created_at timestamptz not null default now()
);

create index rider_shifts_rider_idx on public.rider_shifts (rider_id, started_at desc);
create unique index rider_shifts_one_open_per_rider
  on public.rider_shifts (rider_id) where ended_at is null;

-- ----------------------------------------------------------------------------
-- rider_pings - the location trail, written roughly every 10-15 seconds while
-- a rider is on a job.
--
-- This is by far the highest-write table in the system. It is deliberately
-- separate from riders.current_location so that live map reads stay on a
-- single narrow row, and so the trail can be pruned on a retention schedule
-- without touching operational state.
-- ----------------------------------------------------------------------------
create table public.rider_pings (
  id          bigint generated always as identity primary key,
  rider_id    uuid not null references public.riders(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete set null,
  location    extensions.geography(point, 4326) not null,
  heading     numeric(5, 2),
  speed_kph   numeric(5, 2),
  accuracy_m  numeric(6, 2),
  recorded_at timestamptz not null default now()
);

create index rider_pings_rider_time_idx on public.rider_pings (rider_id, recorded_at desc);
create index rider_pings_order_idx on public.rider_pings (order_id, recorded_at) where order_id is not null;

comment on table public.rider_pings is
  'High-volume location trail. Prune beyond 30 days; riders.current_location holds the live position.';

-- ----------------------------------------------------------------------------
-- delivery_assignments - one row per offer made to a rider.
--
-- sequence supports batching: two orders picked up from the same area and
-- dropped in one run share a rider with sequence 1 and 2.
-- ----------------------------------------------------------------------------
create table public.delivery_assignments (
  id             uuid primary key default extensions.gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  rider_id       uuid not null references public.riders(id) on delete cascade,
  status         public.assignment_status not null default 'offered',

  -- Was this offer made by the algorithm or by a human in the ops console?
  assigned_by    uuid references public.profiles(id),
  is_auto        boolean not null default false,

  sequence       smallint not null default 1,
  distance_to_store_m integer,
  payout_centavos integer not null default 0,

  offered_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  responded_at   timestamptz,
  completed_at   timestamptz,
  decline_reason text,

  created_at     timestamptz not null default now()
);

create index delivery_assignments_order_idx on public.delivery_assignments (order_id, offered_at desc);
create index delivery_assignments_rider_idx on public.delivery_assignments (rider_id, offered_at desc);
-- The rider app polls/subscribes on this; keep it a tiny partial index.
create index delivery_assignments_pending_idx on public.delivery_assignments (rider_id, expires_at)
  where status = 'offered';

-- An order can only have one live rider at a time. Two accepted assignments on
-- one order means two riders arriving at the same kitchen, so the database
-- refuses it rather than trusting the dispatch code to be careful.
create unique index delivery_assignments_one_active_per_order
  on public.delivery_assignments (order_id)
  where status in ('offered', 'accepted');

-- ----------------------------------------------------------------------------
-- current_rider_for_order - used by RLS and by the customer tracking view.
-- Kept as a function so "who is delivering this" has one definition.
-- ----------------------------------------------------------------------------
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
  order by a.offered_at desc
  limit 1;
$$;

-- >>> 20260828000650_payments_promos_ledger.sql

-- ============================================================================
-- 0006b  Promos, payments, the ledger, and payouts
-- ----------------------------------------------------------------------------
-- Money moves through three layers and they are kept strictly separate:
--   payments        - what a provider (PayMongo/Xendit) told us happened
--   ledger_entries  - what each party earned or owes, in our own books
--   payouts         - what we actually sent out, and when
-- Collapsing these into one table is the usual mistake; it makes "the provider
-- says paid but the merchant was never credited" impossible to even express.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- promos
-- ----------------------------------------------------------------------------
create table public.promos (
  id             uuid primary key default extensions.gen_random_uuid(),
  code           extensions.citext not null unique,
  description    text,
  type           public.promo_type not null,
  -- percent_off: 10.00 means 10%. fixed_off / free_delivery: centavos cap.
  value          numeric(10, 2) not null default 0,
  max_discount_centavos integer,
  min_order_centavos    integer not null default 0,

  -- Null merchant_id = platform-wide. Set = valid at that store only.
  merchant_id    uuid references public.merchants(id) on delete cascade,
  funded_by      public.promo_funder not null default 'platform',
  merchant_share numeric(5, 4) not null default 0,

  starts_at      timestamptz not null default now(),
  ends_at        timestamptz,
  usage_limit    integer,
  per_user_limit integer not null default 1,
  -- Maintained by trigger; makes the "limit reached" check a single read.
  usage_count    integer not null default 0,

  first_order_only boolean not null default false,
  is_active      boolean not null default true,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint promos_share_range check (merchant_share between 0 and 1),
  constraint promos_window check (ends_at is null or ends_at > starts_at)
);

create index promos_active_idx on public.promos (code) where is_active;

create trigger promos_touch before update on public.promos
  for each row execute function public.touch_updated_at();

-- Now that promos exists, close the loop from orders.
alter table public.orders
  add constraint orders_promo_fk
  foreign key (promo_id) references public.promos(id) on delete set null;

create table public.promo_redemptions (
  id                uuid primary key default extensions.gen_random_uuid(),
  promo_id          uuid not null references public.promos(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  order_id          uuid not null references public.orders(id) on delete cascade,
  discount_centavos integer not null,
  created_at        timestamptz not null default now(),
  -- One redemption row per order, so a retry cannot double-count usage.
  unique (order_id)
);

create index promo_redemptions_user_idx on public.promo_redemptions (promo_id, user_id);

create or replace function public.bump_promo_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.promos set usage_count = usage_count + 1 where id = new.promo_id;
  elsif tg_op = 'DELETE' then
    update public.promos set usage_count = greatest(usage_count - 1, 0) where id = old.promo_id;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger promo_redemptions_bump_usage
  after insert or delete on public.promo_redemptions
  for each row execute function public.bump_promo_usage();

-- ----------------------------------------------------------------------------
-- payments - one row per attempt against a provider. An order may have several
-- (customer retries a failed GCash charge), which is why this is not a column
-- on orders.
-- ----------------------------------------------------------------------------
create table public.payments (
  id             uuid primary key default extensions.gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete restrict,
  provider       text not null,          -- 'paymongo' | 'xendit' | 'cash'
  provider_ref   text,                   -- payment intent / charge id
  method         public.payment_method not null,
  amount_centavos integer not null,
  status         public.payment_status not null default 'pending',
  -- The client is given this to redirect into GCash/Maya; it is not a secret,
  -- but it does expire.
  checkout_url   text,
  failure_code   text,
  failure_message text,
  -- Full provider response, kept verbatim. When a dispute lands six months
  -- later, the raw payload is the only thing that settles it.
  raw_response   jsonb,
  paid_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index payments_order_idx on public.payments (order_id, created_at desc);
create unique index payments_provider_ref_key on public.payments (provider, provider_ref)
  where provider_ref is not null;

create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- payment_webhook_events - idempotency ledger for provider callbacks.
--
-- Providers retry aggressively and deliver out of order. The unique constraint
-- on (provider, event_id) is what stops a double-delivered "payment.paid"
-- from crediting a merchant twice. The Edge Function inserts here FIRST and
-- bails on conflict.
-- ----------------------------------------------------------------------------
create table public.payment_webhook_events (
  id           uuid primary key default extensions.gen_random_uuid(),
  provider     text not null,
  event_id     text not null,
  event_type   text,
  payload      jsonb not null,
  processed_at timestamptz,
  process_error text,
  received_at  timestamptz not null default now(),
  unique (provider, event_id)
);

create index payment_webhook_events_unprocessed_idx on public.payment_webhook_events (received_at)
  where processed_at is null;

create table public.refunds (
  id              uuid primary key default extensions.gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete restrict,
  payment_id      uuid references public.payments(id) on delete set null,
  amount_centavos integer not null,
  reason          text not null,
  -- Who absorbs it: 'platform', 'merchant', 'rider'. Drives the ledger entries.
  liable_party    public.ledger_account_type not null default 'platform',
  status          public.payment_status not null default 'pending',
  provider_ref    text,
  requested_by    uuid references public.profiles(id),
  approved_by     uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,

  constraint refunds_amount_positive check (amount_centavos > 0)
);

create index refunds_order_idx on public.refunds (order_id);

-- ----------------------------------------------------------------------------
-- ledger_entries - append-only. Nothing in this table is ever updated or
-- deleted; a correction is a new entry of type 'adjustment' with a note.
--
-- Sign convention: positive = the account is owed money, negative = the
-- account owes money. A merchant's balance is the sum of their entries.
-- ----------------------------------------------------------------------------
create table public.ledger_entries (
  id           bigint generated always as identity primary key,
  account_type public.ledger_account_type not null,
  account_id   uuid,                      -- null for the platform's own account
  order_id     uuid references public.orders(id) on delete set null,
  entry_type   public.ledger_entry_type not null,
  amount_centavos integer not null,
  note         text,
  created_by   uuid references public.profiles(id),
  payout_id    uuid,
  created_at   timestamptz not null default now()
);

create index ledger_entries_account_idx on public.ledger_entries (account_type, account_id, created_at desc);
create index ledger_entries_order_idx on public.ledger_entries (order_id);
create index ledger_entries_unsettled_idx on public.ledger_entries (account_type, account_id)
  where payout_id is null;

comment on table public.ledger_entries is
  'Append-only. Corrections are new adjustment entries, never edits. Balance = sum(amount_centavos).';

create table public.payouts (
  id            uuid primary key default extensions.gen_random_uuid(),
  payee_type    public.ledger_account_type not null,
  payee_id      uuid not null,
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  gross_centavos integer not null default 0,
  deductions_centavos integer not null default 0,
  net_centavos  integer not null default 0,
  status        public.payout_status not null default 'scheduled',
  method        text,
  reference     text,
  note          text,
  processed_by  uuid references public.profiles(id),
  processed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index payouts_payee_idx on public.payouts (payee_type, payee_id, period_end desc);

create trigger payouts_touch before update on public.payouts
  for each row execute function public.touch_updated_at();

alter table public.ledger_entries
  add constraint ledger_entries_payout_fk
  foreign key (payout_id) references public.payouts(id) on delete set null;

-- ----------------------------------------------------------------------------
-- rider_remittances - COD reconciliation. The rider collects cash on our
-- behalf and hands it in; until they do, riders.cash_on_hand_centavos is a
-- real receivable.
-- ----------------------------------------------------------------------------
create table public.rider_remittances (
  id              uuid primary key default extensions.gen_random_uuid(),
  rider_id        uuid not null references public.riders(id) on delete restrict,
  amount_centavos integer not null,
  method          text,          -- 'cash_to_office' | 'bank_deposit' | 'gcash'
  reference       text,
  proof_path      text,
  received_by     uuid references public.profiles(id),
  received_at     timestamptz,
  created_at      timestamptz not null default now(),

  constraint rider_remittances_amount_positive check (amount_centavos > 0)
);

create index rider_remittances_rider_idx on public.rider_remittances (rider_id, created_at desc);

-- ----------------------------------------------------------------------------
-- support_tickets - customer-reported problems, attached to an order when
-- there is one. The refund path starts here.
-- ----------------------------------------------------------------------------
create table public.support_tickets (
  id          uuid primary key default extensions.gen_random_uuid(),
  order_id    uuid references public.orders(id) on delete set null,
  raised_by   uuid not null references public.profiles(id) on delete cascade,
  category    text not null,   -- missing_item, late, wrong_order, rider_conduct, payment
  subject     text not null,
  body        text,
  status      public.ticket_status not null default 'open',
  assigned_to uuid references public.profiles(id),
  resolution  text,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index support_tickets_status_idx on public.support_tickets (status, created_at desc);
create index support_tickets_raiser_idx on public.support_tickets (raised_by, created_at desc);

create trigger support_tickets_touch before update on public.support_tickets
  for each row execute function public.touch_updated_at();

create table public.support_messages (
  id         uuid primary key default extensions.gen_random_uuid(),
  ticket_id  uuid not null references public.support_tickets(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  -- Internal notes are visible to staff only; the RLS policy in 0009 enforces it.
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

-- >>> 20260828000700_security_helpers.sql

-- ============================================================================
-- 0007  Security helpers
-- ----------------------------------------------------------------------------
-- These must be created AFTER the tables they read, because Postgres validates
-- SQL function bodies at CREATE time. They are the single source of truth for
-- "who is this caller" and are the only thing the RLS policies in 0009 ask.
-- ============================================================================

-- All are STABLE + SECURITY DEFINER so they can read profiles without being
-- caught by the very policies they are used to evaluate (which would recurse).
-- search_path is pinned on every definer function: without it, a caller can
-- shadow `public` and hijack the function body.
-- ----------------------------------------------------------------------------

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('admin', 'support') from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- True when the caller belongs to this merchant in any capacity.
create or replace function public.is_merchant_member(p_merchant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.merchant_members m
    where m.merchant_id = p_merchant_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_merchant_owner(p_merchant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.merchant_members m
    where m.merchant_id = p_merchant_id
      and m.user_id = auth.uid()
      and m.is_owner
  );
$$;

create or replace function public.is_rider()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.riders r where r.id = auth.uid());
$$;

-- >>> 20260828000800_order_functions.sql

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
    select * into v_promo from public.promos
    where code = trim(p_promo_code) and is_active;

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
    -- Six-digit handover code. Cheap proof of delivery that works without a
    -- camera and without a data connection at the door.
    lpad(floor(random() * 1000000)::text, 6, '0')
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

        -- Proof of delivery, when the customer was given a code.
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
  if not (public.is_admin() or p_is_auto) then
    raise exception 'only ops may assign riders' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.status not in ('placed', 'accepted', 'preparing', 'ready_for_pickup') then
    raise exception 'order % is not dispatchable (status %)', v_order.code, v_order.status
      using errcode = 'P0001';
  end if;

  select * into v_merchant from public.merchants where id = v_order.merchant_id;

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
-- expire_stale_offers - swept by a scheduled Edge Function every 15 seconds.
-- An offer nobody answered must not pin an order forever.
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

-- >>> 20260828000900_rls.sql

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
revoke execute on function public.offer_order_to_rider(uuid, uuid, boolean) from anon;
revoke execute on function public.handle_new_user() from anon, authenticated;

grant execute on function public.price_cart(uuid, uuid, text, integer, public.order_type) to authenticated;
grant execute on function public.place_order(uuid, uuid, public.payment_method, text, integer, public.order_type, text, timestamptz) to authenticated;
grant execute on function public.advance_order(uuid, public.order_status, text, text) to authenticated;
grant execute on function public.respond_to_assignment(uuid, boolean, text) to authenticated;
grant execute on function public.record_rider_ping(double precision, double precision, uuid, numeric, numeric, numeric) to authenticated;
grant execute on function public.quote_delivery(uuid, extensions.geography) to anon, authenticated;
grant execute on function public.is_merchant_open(uuid, timestamptz) to anon, authenticated;

-- >>> 20260828001000_realtime_and_storage.sql

-- ============================================================================
-- 0010  Realtime publication and storage buckets
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Realtime
--
-- Only four tables are published, and each earns it:
--   orders               - the customer tracking screen and the merchant board
--   order_events         - the status timeline, appended once per transition
--   delivery_assignments - the rider's incoming-offer alert
--   riders               - the moving pin on the customer's map
--
-- rider_pings is deliberately NOT published. It is the highest-write table in
-- the system and broadcasting every 10-second GPS sample to every subscriber
-- is how a realtime bill becomes the largest line item in the business.
-- The live position is read from riders.current_location instead.
--
-- Realtime respects RLS, so subscribers receive only rows their policies in
-- 0009 already allow them to select.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_events;
alter publication supabase_realtime add table public.delivery_assignments;
alter publication supabase_realtime add table public.riders;

-- Send the previous row alongside the new one, so a subscriber can tell
-- "accepted -> preparing" from a plain metadata touch without a second query.
alter table public.orders replica identity full;
alter table public.delivery_assignments replica identity full;

-- ----------------------------------------------------------------------------
-- Storage buckets
--
-- Public buckets hold things that appear on the storefront and are meaningless
-- to an attacker. Private buckets hold identity documents and proof-of-delivery
-- photos, which are exactly the things that must never be guessable URLs.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('menu-images',    'menu-images',    true,  5242880,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('merchant-assets','merchant-assets',true,  5242880,
   array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']),
  ('avatars',        'avatars',        true,  2097152,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('documents',      'documents',      false, 10485760,
   array['image/jpeg', 'image/png', 'application/pdf']),
  ('delivery-proof', 'delivery-proof', false, 5242880,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Path convention, relied on by every policy below:
--   menu-images/<merchant_id>/<item_id>.jpg
--   merchant-assets/<merchant_id>/logo.png
--   avatars/<user_id>/avatar.jpg
--   documents/<owner_id>/<doc_type>-<uuid>.pdf
--   delivery-proof/<order_id>/<uuid>.jpg

create policy "public buckets are readable"
  on storage.objects for select
  using (bucket_id in ('menu-images', 'merchant-assets', 'avatars'));

create policy "merchant members write their own media"
  on storage.objects for all to authenticated
  using (
    bucket_id in ('menu-images', 'merchant-assets')
    and public.is_merchant_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id in ('menu-images', 'merchant-assets')
    and public.is_merchant_member((storage.foldername(name))[1]::uuid)
  );

create policy "users write their own avatar"
  on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Documents are write-your-own, read-your-own. Ops reviews them through the
-- service role, which bypasses this entirely.
create policy "owners manage their own documents"
  on storage.objects for all to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- Proof of delivery: the assigned rider uploads it, the order's participants
-- can read it. Nobody can enumerate the bucket.
create policy "rider uploads proof of delivery"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'delivery-proof'
    and public.current_rider_for_order((storage.foldername(name))[1]::uuid) = auth.uid()
  );

create policy "order participants read proof of delivery"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'delivery-proof'
    and public.can_view_order((storage.foldername(name))[1]::uuid)
  );

-- >>> 20260828001100_app_rpcs.sql

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

  while exists (select 1 from public.merchants where slug = v_slug) loop
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
