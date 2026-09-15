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
