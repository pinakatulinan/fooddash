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
