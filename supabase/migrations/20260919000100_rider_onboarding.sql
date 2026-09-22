-- ============================================================================
-- 0015  Rider onboarding: application details, document review, and two
--       privilege escalations closed along the way
-- ----------------------------------------------------------------------------
-- Until now there was no onboarding flow, so the two holes below were never
-- reachable in practice - a `riders` row only ever came from a seed script.
-- Building the flow meant looking at what the database would actually let a
-- caller do, and both were open:
--
--   * riders_self_insert allowed `id = auth.uid()` with no column limit, so
--     any signed-in account - a plain customer included - could insert its
--     own riders row with is_verified = true and start receiving jobs,
--     skipping ops review entirely.
--   * rider_documents_own was `for all`, so a rider could insert a document
--     already marked 'approved', or update their own pending one to it.
--
-- A rider row now only comes from submit_rider_application() and is always
-- created unverified; document status only changes through
-- review_rider_document(), which is admin-only and audit-logged.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Close the holes.
-- ---------------------------------------------------------------------------
drop policy riders_self_insert on public.riders;
revoke insert on public.riders from authenticated;

drop policy rider_documents_own on public.rider_documents;

create policy rider_documents_read on public.rider_documents
  for select using (rider_id = auth.uid() or public.is_admin());

-- A rider may only add a fresh, unreviewed document pointing into their own
-- folder of the private bucket - never a pre-approved one, and never a path
-- into somebody else's files.
create policy rider_documents_insert on public.rider_documents
  for insert with check (
    rider_id = auth.uid()
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and review_note is null
    and split_part(storage_path, '/', 1) = auth.uid()::text
  );

-- Replacing a rejected or still-pending upload means deleting the old row;
-- an approved one is ops' record and stays.
create policy rider_documents_delete_unapproved on public.rider_documents
  for delete using (rider_id = auth.uid() and status <> 'approved');

-- No update policy at all: review goes through review_rider_document().

-- NOT VALID: applies to every new row without failing the migration over a
-- stray legacy value.
alter table public.rider_documents
  add constraint rider_documents_doc_type_known
  check (doc_type in ('drivers_license', 'or_cr', 'nbi_clearance', 'selfie_id')) not valid;

-- ---------------------------------------------------------------------------
-- 2. What a rider tells us about themselves.
--
-- Separate from `riders` on purpose: that row is on the dispatch hot path and
-- read by ops lists, while this is personal data (birthdate, home address,
-- payout account) that only the rider and ops should ever see.
-- ---------------------------------------------------------------------------
create table public.rider_applications (
  rider_id                uuid primary key references public.riders(id) on delete cascade,
  date_of_birth           date not null,
  address_line1           text not null,
  barangay                text,
  city                    text not null,
  emergency_contact_name  text not null,
  emergency_contact_phone text not null,
  payout_method           text not null,
  payout_account_name     text not null,
  payout_account_number   text not null,
  accepted_terms_at       timestamptz not null,
  submitted_at            timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint rider_applications_payout_method check (payout_method in ('gcash', 'maya', 'bank')),
  constraint rider_applications_emergency_phone_format check (emergency_contact_phone ~ '^\+63[0-9]{10}$')
);

create trigger rider_applications_touch before update on public.rider_applications
  for each row execute function public.touch_updated_at();

alter table public.rider_applications enable row level security;
revoke all on public.rider_applications from anon;

-- Read only. Writes go through submit_rider_application(), so there is no
-- insert/update/delete policy for anyone.
create policy rider_applications_read on public.rider_applications
  for select using (rider_id = auth.uid() or public.is_admin());

-- Ops sees a rider's review status change live, and so does the rider.
alter publication supabase_realtime add table public.rider_documents;

-- ---------------------------------------------------------------------------
-- 3. Which documents a vehicle needs. The licence and OR/CR only make sense
--    for a motorised vehicle; everyone needs a clearance and a selfie ID.
--    (src/lib/domain/rider-documents.ts mirrors this for the form's checklist;
--    this function is the authority - verify_rider() reads it.)
-- ---------------------------------------------------------------------------
create or replace function public.rider_required_documents(p_vehicle public.vehicle_type)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case
    when p_vehicle in ('motorcycle', 'car')
      then array['drivers_license', 'or_cr', 'nbi_clearance', 'selfie_id']
    else array['nbi_clearance', 'selfie_id']
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4. submit_rider_application - the only way a riders row comes into being.
--    Re-callable while unverified, so a typo in a plate number is fixable
--    without ops; refused once verified, so it cannot be used to quietly
--    swap the vehicle under an approved rider.
-- ---------------------------------------------------------------------------
create or replace function public.submit_rider_application(
  p_vehicle                 public.vehicle_type,
  p_plate_number            text,
  p_home_zone_id            uuid,
  p_date_of_birth           date,
  p_address_line1           text,
  p_barangay                text,
  p_city                    text,
  p_emergency_contact_name  text,
  p_emergency_contact_phone text,
  p_payout_method           text,
  p_payout_account_name     text,
  p_payout_account_number   text,
  p_accepted_terms          boolean
)
returns public.riders
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_plate   text := nullif(upper(trim(coalesce(p_plate_number, ''))), '');
  v_account text := regexp_replace(coalesce(p_payout_account_number, ''), '\s', '', 'g');
  v_rider   public.riders;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();

  if v_profile.role is distinct from 'rider' then
    raise exception 'Only rider accounts can apply to deliver.' using errcode = '42501';
  end if;
  if v_profile.phone is null then
    raise exception 'Add your mobile number to your profile first.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.riders where id = auth.uid() and is_verified) then
    raise exception 'Your rider account is already verified.' using errcode = 'P0001';
  end if;
  if not coalesce(p_accepted_terms, false) then
    raise exception 'You need to accept the rider terms to continue.' using errcode = 'P0001';
  end if;

  if p_date_of_birth is null or p_date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'You must be at least 18 to deliver.' using errcode = 'P0001';
  end if;
  if p_date_of_birth < (current_date - interval '80 years')::date then
    raise exception 'Check your date of birth.' using errcode = 'P0001';
  end if;

  if p_vehicle in ('motorcycle', 'car') then
    if v_plate is null then
      raise exception 'Enter your vehicle plate number.' using errcode = 'P0001';
    end if;
    if v_plate !~ '^[A-Z0-9 -]{5,10}$' then
      raise exception 'That does not look like a valid plate number.' using errcode = 'P0001';
    end if;
  else
    v_plate := null;
  end if;

  if not exists (select 1 from public.service_zones where id = p_home_zone_id and is_active) then
    raise exception 'Choose the zone you will deliver in.' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_address_line1, '')), '') is null
     or nullif(trim(coalesce(p_city, '')), '') is null then
    raise exception 'Enter your home address.' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_emergency_contact_name, '')), '') is null then
    raise exception 'Enter an emergency contact.' using errcode = 'P0001';
  end if;
  if coalesce(p_emergency_contact_phone, '') !~ '^\+63[0-9]{10}$' then
    raise exception 'Enter a valid Philippine mobile number for your emergency contact.' using errcode = 'P0001';
  end if;
  if p_emergency_contact_phone = v_profile.phone then
    raise exception 'Your emergency contact needs a different number from your own.' using errcode = 'P0001';
  end if;

  if p_payout_method is null or p_payout_method not in ('gcash', 'maya', 'bank') then
    raise exception 'Choose how you want to be paid.' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_payout_account_name, '')), '') is null then
    raise exception 'Enter the name on your payout account.' using errcode = 'P0001';
  end if;
  if v_account !~ '^[0-9]{7,20}$' then
    raise exception 'Enter a valid payout account number.' using errcode = 'P0001';
  end if;

  insert into public.riders (id, vehicle, plate_number, home_zone_id)
  values (auth.uid(), p_vehicle, v_plate, p_home_zone_id)
  on conflict (id) do update
    set vehicle = excluded.vehicle,
        plate_number = excluded.plate_number,
        home_zone_id = excluded.home_zone_id
  returning * into v_rider;

  insert into public.rider_applications (
    rider_id, date_of_birth, address_line1, barangay, city,
    emergency_contact_name, emergency_contact_phone,
    payout_method, payout_account_name, payout_account_number, accepted_terms_at
  ) values (
    auth.uid(), p_date_of_birth, trim(p_address_line1), nullif(trim(coalesce(p_barangay, '')), ''), trim(p_city),
    trim(p_emergency_contact_name), p_emergency_contact_phone,
    p_payout_method, trim(p_payout_account_name), v_account, now()
  )
  on conflict (rider_id) do update
    set date_of_birth = excluded.date_of_birth,
        address_line1 = excluded.address_line1,
        barangay = excluded.barangay,
        city = excluded.city,
        emergency_contact_name = excluded.emergency_contact_name,
        emergency_contact_phone = excluded.emergency_contact_phone,
        payout_method = excluded.payout_method,
        payout_account_name = excluded.payout_account_name,
        payout_account_number = excluded.payout_account_number;

  return v_rider;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Ops: review one document, then verify the rider once all are approved.
-- ---------------------------------------------------------------------------
create or replace function public.review_rider_document(
  p_document_id uuid,
  p_approve     boolean,
  p_note        text default null
)
returns public.rider_documents
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_doc  public.rider_documents;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Say why it was rejected so the rider knows what to fix.' using errcode = 'P0001';
  end if;

  update public.rider_documents
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
    case when p_approve then 'approve_rider_document' else 'reject_rider_document' end,
    'rider_documents', v_doc.id::text,
    jsonb_build_object('rider_id', v_doc.rider_id, 'doc_type', v_doc.doc_type, 'status', v_doc.status),
    v_note
  );

  return v_doc;
end;
$$;

create or replace function public.verify_rider(p_rider_id uuid)
returns public.riders
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rider   public.riders;
  v_missing text[];
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_rider from public.riders where id = p_rider_id for update;
  if v_rider.id is null then
    raise exception 'That rider no longer exists.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.rider_applications where rider_id = p_rider_id) then
    raise exception 'This rider has not submitted an application yet.' using errcode = 'P0001';
  end if;

  select array(
    select d
    from unnest(public.rider_required_documents(v_rider.vehicle)) as d
    where not exists (
      select 1 from public.rider_documents x
      where x.rider_id = p_rider_id
        and x.doc_type = d
        and x.status = 'approved'
        and (x.expires_at is null or x.expires_at >= current_date)
    )
  ) into v_missing;

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception 'Still missing approved documents: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;

  update public.riders
  set is_verified = true, verified_at = now(), verified_by = auth.uid()
  where id = p_rider_id
  returning * into v_rider;

  insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'verify_rider', 'riders', p_rider_id::text, jsonb_build_object('is_verified', true));

  return v_rider;
end;
$$;

revoke execute on function public.submit_rider_application(public.vehicle_type, text, uuid, date, text, text, text, text, text, text, text, text, boolean) from anon;
revoke execute on function public.review_rider_document(uuid, boolean, text) from anon;
revoke execute on function public.verify_rider(uuid) from anon;
grant execute on function public.submit_rider_application(public.vehicle_type, text, uuid, date, text, text, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.review_rider_document(uuid, boolean, text) to authenticated;
grant execute on function public.verify_rider(uuid) to authenticated;
