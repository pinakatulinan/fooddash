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
