-- ============================================================================
-- 0020  address_location_latlng - lets the discovery page search and label
--       "near you" using the customer's own saved address instead of a
--       single hardcoded city for every signed-in user.
-- ----------------------------------------------------------------------------
-- Same reason merchant_location_latlng (0016) exists: PostgREST has no way to
-- select a geography column back out as plain lat/lng, and nearby_merchants()
-- takes lat/lng, not an address id.
-- ============================================================================

create or replace function public.address_location_latlng(p_address_id uuid)
returns table (lat double precision, lng double precision)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select extensions.st_y(location::extensions.geometry), extensions.st_x(location::extensions.geometry)
  from public.addresses
  where id = p_address_id
    and user_id = auth.uid()
    and archived_at is null;
$$;

revoke execute on function public.address_location_latlng(uuid) from anon;
grant execute on function public.address_location_latlng(uuid) to authenticated;
