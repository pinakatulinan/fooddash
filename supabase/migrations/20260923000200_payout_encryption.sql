-- ============================================================================
-- 0023  Encrypt payout account numbers at rest.
-- ----------------------------------------------------------------------------
-- riders.payout_account_number (via rider_applications) and
-- merchants.payout_account_number have held plain GCash/Maya/bank account
-- numbers since 0015/0003. No merchant-side UI ever wrote to the merchants
-- column - only the rider application flow has a real write path today -
-- but both get the same treatment, so whichever merchant payout form gets
-- built later is forced through an encrypting RPC from day one instead of
-- inheriting a plaintext column by default.
--
-- The key lives in Supabase Vault, not in a platform_settings row or an app
-- environment variable: it never has to pass through the browser or app
-- server at all, only through payout_encryption_key() below, which nothing
-- outside another SECURITY DEFINER function can call.
-- ============================================================================

create extension if not exists "supabase_vault";

-- Created once. Re-pasting this migration must not mint a second key and
-- orphan whatever was already encrypted with the first one.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'payout_encryption_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'payout_encryption_key',
      'Symmetric key for rider/merchant payout account numbers at rest (0023). Never exposed outside a SECURITY DEFINER function.'
    );
  end if;
end $$;

create or replace function public.payout_encryption_key()
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'payout_encryption_key';
$$;

revoke execute on function public.payout_encryption_key() from anon, authenticated;

-- Encrypts whatever plaintext is already sitting in these columns as part of
-- the same statement that changes their type - there is no window where the
-- column is bytea but still holds unencrypted bytes.
alter table public.rider_applications
  alter column payout_account_number type bytea
  using extensions.pgp_sym_encrypt(payout_account_number, public.payout_encryption_key());

alter table public.merchants
  alter column payout_account_number type bytea
  using case
    when payout_account_number is null then null
    else extensions.pgp_sym_encrypt(payout_account_number, public.payout_encryption_key())
  end;

-- ---------------------------------------------------------------------------
-- submit_rider_application - redefined only to encrypt before storing.
-- Every validation rule, and the function's signature, are unchanged, so
-- application-form.tsx needs no changes at all.
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
set search_path = public, extensions
as $$
declare
  v_profile   public.profiles;
  v_plate     text := nullif(upper(trim(coalesce(p_plate_number, ''))), '');
  v_account   text := regexp_replace(coalesce(p_payout_account_number, ''), '\s', '', 'g');
  v_account_enc bytea;
  v_rider     public.riders;
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

  v_account_enc := extensions.pgp_sym_encrypt(v_account, public.payout_encryption_key());

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
    p_payout_method, trim(p_payout_account_name), v_account_enc, now()
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
-- decrypt_rider_payout_account - the only way the real number is ever read
-- back. Owner-or-admin, the same shape as every other rider_applications/
-- rider_documents read in this codebase: a rider editing their own
-- application (rider/onboarding/page.tsx) needs their own number back to
-- pre-fill the form, not just ops reviewing it.
-- admin/riders/[id]/page.tsx (0015) used to select the column straight off
-- rider_applications; both call sites now call this instead, since the raw
-- column is ciphertext.
-- ---------------------------------------------------------------------------
create or replace function public.decrypt_rider_payout_account(p_rider_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_encrypted bytea;
begin
  if p_rider_id <> auth.uid() and not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select payout_account_number into v_encrypted
  from public.rider_applications
  where rider_id = p_rider_id;

  if v_encrypted is null then
    return null;
  end if;

  return extensions.pgp_sym_decrypt(v_encrypted, public.payout_encryption_key());
end;
$$;

revoke execute on function public.decrypt_rider_payout_account(uuid) from anon;
grant execute on function public.decrypt_rider_payout_account(uuid) to authenticated;
