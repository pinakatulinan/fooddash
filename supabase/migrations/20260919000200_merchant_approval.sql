-- ============================================================================
-- 0016  Merchant approval: address/location, document review, and closing the
--       same kind of hole 0015 closed on the rider side.
-- ----------------------------------------------------------------------------
-- merchant_documents_member was a single `for all` policy whose with check
-- only allowed a merchant member, not an admin - so an admin's own raw update
-- to approve a document would have been rejected by RLS. Nobody had hit it
-- yet because nothing ever wrote merchant_documents.status at all: there was
-- no submit-for-review step, no approve/reject RPC, and no UI to upload a
-- document in the first place. This migration builds that whole path and
-- replaces the one loose policy with the same read/insert/delete split 0015
-- used for rider_documents, so status changes only ever happen through
-- review_merchant_document().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Split merchant_documents_member the same way rider_documents_own was
--    split in 0015.
-- ---------------------------------------------------------------------------
drop policy merchant_documents_member on public.merchant_documents;

create policy merchant_documents_read on public.merchant_documents
  for select using (public.is_merchant_member(merchant_id) or public.is_admin());

-- A member may only add a fresh, unreviewed document into their own store's
-- folder - never a pre-approved one, and never a path into another store's.
create policy merchant_documents_insert on public.merchant_documents
  for insert with check (
    public.is_merchant_member(merchant_id)
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and review_note is null
    and split_part(storage_path, '/', 1) = merchant_id::text
  );

create policy merchant_documents_delete_unapproved on public.merchant_documents
  for delete using (public.is_merchant_member(merchant_id) and status <> 'approved');

-- No update policy at all: review goes through review_merchant_document().

alter table public.merchant_documents
  add constraint merchant_documents_doc_type_known
  check (doc_type in ('business_permit', 'bir_registration', 'sanitary_permit')) not valid;

alter publication supabase_realtime add table public.merchant_documents;

-- ---------------------------------------------------------------------------
-- 2. Which documents every store needs, mirroring rider_required_documents().
--    src/lib/domain/merchant-documents.ts mirrors this for the checklist UI;
--    this function is the authority.
-- ---------------------------------------------------------------------------
create or replace function public.merchant_required_documents()
returns text[]
language sql
immutable
as $$
  select array['business_permit', 'bir_registration', 'sanitary_permit'];
$$;

-- ---------------------------------------------------------------------------
-- 3. update_merchant_address - line1/barangay/city/province/postal_code plus
--    the geography point together, in one transaction. The point can't be set
--    through a raw client update the way the text columns can (see the
--    column grants in 0009) - nearby_merchants() and quote_delivery() both
--    build it the same way, from a lat/lng pair via st_makepoint.
-- ---------------------------------------------------------------------------
create or replace function public.update_merchant_address(
  p_merchant_id  uuid,
  p_line1        text,
  p_barangay     text,
  p_city         text,
  p_province     text,
  p_postal_code  text,
  p_lat          double precision,
  p_lng          double precision
)
returns public.merchants
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_merchant public.merchants;
begin
  if not public.is_merchant_member(p_merchant_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_line1, '')), '') is null
     or nullif(trim(coalesce(p_city, '')), '') is null then
    raise exception 'Enter your store''s address.' using errcode = 'P0001';
  end if;
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Set your store''s location on the map.' using errcode = 'P0001';
  end if;

  update public.merchants
  set line1       = trim(p_line1),
      barangay    = nullif(trim(coalesce(p_barangay, '')), ''),
      city        = trim(p_city),
      province    = nullif(trim(coalesce(p_province, '')), ''),
      postal_code = nullif(trim(coalesce(p_postal_code, '')), ''),
      location    = extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
  where id = p_merchant_id
  returning * into v_merchant;

  if v_merchant.id is null then
    raise exception 'That store no longer exists.' using errcode = 'P0002';
  end if;

  return v_merchant;
end;
$$;

-- update_merchant_address only ever writes the point, never reads it back in
-- a form a browser can prefill from - PostgREST has no way to select it as
-- lat/lng directly. Small read-only helper for exactly that.
create or replace function public.merchant_location_latlng(p_merchant_id uuid)
returns table (lat double precision, lng double precision)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select extensions.st_y(location::extensions.geometry), extensions.st_x(location::extensions.geometry)
  from public.merchants
  where id = p_merchant_id
    and (public.is_merchant_member(p_merchant_id) or public.is_admin())
    and location is not null;
$$;

revoke execute on function public.merchant_location_latlng(uuid) from anon;
grant execute on function public.merchant_location_latlng(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. submit_merchant_for_review - draft or rejected -> pending_review, once
--    everything ops needs to decide is actually there. Re-callable after a
--    rejection so fixing the one thing that was wrong doesn't need ops to
--    reset anything first.
-- ---------------------------------------------------------------------------
create or replace function public.submit_merchant_for_review(p_merchant_id uuid)
returns public.merchants
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_merchant public.merchants;
  v_missing  text[];
begin
  if not public.is_merchant_member(p_merchant_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_merchant from public.merchants where id = p_merchant_id for update;
  if v_merchant.id is null then
    raise exception 'That store no longer exists.' using errcode = 'P0002';
  end if;
  if v_merchant.status = 'pending_review' then
    raise exception 'This store is already awaiting review.' using errcode = 'P0001';
  end if;
  if v_merchant.status in ('approved', 'suspended') then
    raise exception 'This store is already approved.' using errcode = 'P0001';
  end if;

  if v_merchant.phone is null then
    raise exception 'Add a phone number ops can reach you on.' using errcode = 'P0001';
  end if;
  if v_merchant.line1 is null or v_merchant.city is null or v_merchant.location is null then
    raise exception 'Set your store''s address and location first.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.merchant_hours where merchant_id = p_merchant_id) then
    raise exception 'Set at least one day of opening hours.' using errcode = 'P0001';
  end if;

  select array(
    select d
    from unnest(public.merchant_required_documents()) as d
    where not exists (
      select 1 from public.merchant_documents x
      where x.merchant_id = p_merchant_id and x.doc_type = d
    )
  ) into v_missing;

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception 'Still need to upload: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;

  update public.merchants
  set status = 'pending_review', rejection_reason = null
  where id = p_merchant_id
  returning * into v_merchant;

  return v_merchant;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Ops: review one document, then approve or reject the store.
-- ---------------------------------------------------------------------------
create or replace function public.review_merchant_document(
  p_document_id uuid,
  p_approve     boolean,
  p_note        text default null
)
returns public.merchant_documents
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_doc  public.merchant_documents;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Say why it was rejected so the store knows what to fix.' using errcode = 'P0001';
  end if;

  update public.merchant_documents
  set status      = (case when p_approve then 'approved' else 'rejected' end)::public.document_status,
      review_note = v_note,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_document_id
  returning * into v_doc;

  if v_doc.id is null then
    raise exception 'That document no longer exists.' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, after, note)
  values (
    auth.uid(),
    case when p_approve then 'approve_merchant_document' else 'reject_merchant_document' end,
    'merchant_documents', v_doc.id::text,
    jsonb_build_object('merchant_id', v_doc.merchant_id, 'doc_type', v_doc.doc_type, 'status', v_doc.status),
    v_note
  );

  return v_doc;
end;
$$;

create or replace function public.approve_merchant(p_merchant_id uuid)
returns public.merchants
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_merchant public.merchants;
  v_missing  text[];
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_merchant from public.merchants where id = p_merchant_id for update;
  if v_merchant.id is null then
    raise exception 'That store no longer exists.' using errcode = 'P0002';
  end if;
  if v_merchant.status <> 'pending_review' then
    raise exception 'This store is not awaiting review.' using errcode = 'P0001';
  end if;

  select array(
    select d
    from unnest(public.merchant_required_documents()) as d
    where not exists (
      select 1 from public.merchant_documents x
      where x.merchant_id = p_merchant_id and x.doc_type = d and x.status = 'approved'
    )
  ) into v_missing;

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception 'Still missing approved documents: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;

  update public.merchants
  set status = 'approved', approved_at = now(), approved_by = auth.uid(), rejection_reason = null
  where id = p_merchant_id
  returning * into v_merchant;

  insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'approve_merchant', 'merchants', p_merchant_id::text, jsonb_build_object('status', 'approved'));

  return v_merchant;
end;
$$;

create or replace function public.reject_merchant(p_merchant_id uuid, p_reason text)
returns public.merchants
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_merchant public.merchants;
  v_reason   text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Say why it was rejected so the store knows what to fix.' using errcode = 'P0001';
  end if;

  select * into v_merchant from public.merchants where id = p_merchant_id for update;
  if v_merchant.id is null then
    raise exception 'That store no longer exists.' using errcode = 'P0002';
  end if;
  if v_merchant.status <> 'pending_review' then
    raise exception 'This store is not awaiting review.' using errcode = 'P0001';
  end if;

  update public.merchants
  set status = 'rejected', rejection_reason = v_reason
  where id = p_merchant_id
  returning * into v_merchant;

  insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, after, note)
  values (auth.uid(), 'reject_merchant', 'merchants', p_merchant_id::text, jsonb_build_object('status', 'rejected'), v_reason);

  return v_merchant;
end;
$$;

revoke execute on function public.update_merchant_address(uuid, text, text, text, text, text, double precision, double precision) from anon;
revoke execute on function public.submit_merchant_for_review(uuid) from anon;
revoke execute on function public.review_merchant_document(uuid, boolean, text) from anon;
revoke execute on function public.approve_merchant(uuid) from anon;
revoke execute on function public.reject_merchant(uuid, text) from anon;
grant execute on function public.update_merchant_address(uuid, text, text, text, text, text, double precision, double precision) to authenticated;
grant execute on function public.submit_merchant_for_review(uuid) to authenticated;
grant execute on function public.review_merchant_document(uuid, boolean, text) to authenticated;
grant execute on function public.approve_merchant(uuid) to authenticated;
grant execute on function public.reject_merchant(uuid, text) to authenticated;
