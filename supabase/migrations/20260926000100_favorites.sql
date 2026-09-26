-- ============================================================================
-- 0025  Customer favorites, and a public read of a merchant's pin
-- ----------------------------------------------------------------------------
-- Two small, related additions:
--   1. favorites - a customer can save a restaurant or a menu item. One table,
--      not two, since "which one" is just which foreign key is set; a single
--      check constraint keeps a row from claiming to be both or neither.
--   2. merchant_public_location - the store page needs a merchant's pin to
--      show it on a map. merchant_location_latlng (0016) already does this
--      lookup but is deliberately staff/admin-only (it backs the "edit your
--      own address" flow) - it returns nothing for a browsing customer. An
--      *approved* merchant's location is not sensitive the way a rider's live
--      position or a customer's home address is: the store page already shows
--      its barangay/city as plain text to anyone, RLS already lets any visitor
--      load its full menu, and no third party (a rider, another customer) is
--      implicated the way order_tracking's live position is. Scoped to
--      status = 'approved' so a pending or suspended merchant's pin does not
--      leak before the store is actually public.
-- ============================================================================

create table public.favorites (
  id          uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  merchant_id uuid references public.merchants(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete cascade,
  created_at  timestamptz not null default now(),

  -- Exactly one target per row. Postgres treats NULL as distinct from NULL in
  -- a unique constraint, so favorites_unique_merchant/_item below only ever
  -- compare rows that actually share the same non-null target.
  constraint favorites_one_target check (
    (merchant_id is not null and menu_item_id is null) or
    (merchant_id is null and menu_item_id is not null)
  ),
  constraint favorites_unique_merchant unique (customer_id, merchant_id),
  constraint favorites_unique_item unique (customer_id, menu_item_id)
);

create index favorites_customer_idx on public.favorites (customer_id, created_at desc);

alter table public.favorites enable row level security;

create policy favorites_own on public.favorites
  for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());

revoke all on public.favorites from anon;
grant select, insert, delete on public.favorites to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.merchant_public_location(p_merchant_id uuid)
returns table (lat double precision, lng double precision)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select extensions.st_y(location::extensions.geometry), extensions.st_x(location::extensions.geometry)
  from public.merchants
  where id = p_merchant_id
    and status = 'approved'
    and location is not null;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default - revoking from named
-- roles alone does not touch that separate grant (0024). Explicit every time
-- from here on.
revoke execute on function public.merchant_public_location(uuid) from public;
grant execute on function public.merchant_public_location(uuid) to anon, authenticated;
