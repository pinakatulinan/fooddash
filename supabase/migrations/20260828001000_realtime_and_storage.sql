-- ============================================================================
-- 0010  Realtime publication and storage buckets
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Realtime
--
-- Each published table earns it:
--   orders               - the customer tracking screen and the merchant board
--   order_events         - the status timeline, appended once per transition
--   delivery_assignments - the rider's incoming-offer alert
--   riders               - the moving pin on the customer's map
--   notifications        - the bell (see notification-bell.tsx) updating without a reopen
--   support_messages      - a ticket thread updating without a reload, either side
--   support_tickets       - a ticket's own status/resolution changing live
--   merchants             - admin's "stores to review" count on the live ops board
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
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.support_messages;
alter publication supabase_realtime add table public.support_tickets;
alter publication supabase_realtime add table public.merchants;

-- Send the previous row alongside the new one, so a subscriber can tell
-- "accepted -> preparing" from a plain metadata touch without a second query.
alter table public.orders replica identity full;
alter table public.delivery_assignments replica identity full;
alter table public.support_tickets replica identity full;

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
