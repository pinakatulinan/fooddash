-- ============================================================================
-- 0024  Close a gap that has existed since the very first RLS migration
--       (0009): every `revoke execute ... from anon, authenticated` in this
--       project left PostgreSQL's own default grant to PUBLIC untouched.
-- ----------------------------------------------------------------------------
-- CREATE FUNCTION grants EXECUTE to PUBLIC unless told not to. Revoking from
-- anon and authenticated by name does not touch that separate PUBLIC grant -
-- and since every role is implicitly covered by PUBLIC, anon and
-- authenticated kept working through it regardless of the named revoke.
-- Every "cron-only" and "admin-only" function in this project has been
-- reachable through PostgREST this whole time.
--
-- Found today while testing the rate-limiting and payout-encryption
-- migrations: check_rate_limit and decrypt_rider_payout_account both had
-- tests asserting a non-admin call gets refused, and both tests failed -
-- not flakily, reproducibly. Chasing why turned up two real, live
-- vulnerabilities layered on top of the grant gap:
--
--   * confirm_order_payment/fail_order_payment guarded themselves with
--     `if auth.uid() is not null then raise exception end if` - intended to
--     mean "only pg_cron/service-role", but auth.uid() is ALSO null for a
--     plain anon-key request with nobody signed in (this is the exact bug
--     0010 already fixed once for dispatch_candidates, repeated here).
--     Confirmed exploitable directly: an anon caller's confirm_order_payment
--     call reached "that order no longer exists" - past the auth check,
--     refused only because the test used a fake id.
--   * decrypt_rider_payout_account checked `p_rider_id <> auth.uid()`, which
--     is NULL (neither true nor false) when auth.uid() is NULL for an anon
--     caller - `if NULL and ... then` never fires, so the check silently
--     passed anon through. Confirmed exploitable: payout_encryption_key()
--     itself returned the raw key to a plain anon RPC call with no session
--     at all.
--
-- Because that raw key was directly retrieved during this testing, it must
-- be treated as compromised - this migration also rotates it and
-- re-encrypts every stored payout account number with the new one.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The actual grant fix: revoke from PUBLIC everywhere a role-specific
--    revoke already existed, closing the real hole those statements meant
--    to close in the first place. Grouped by migration for anyone tracing
--    this back later.
-- ---------------------------------------------------------------------------

-- 0009 - the original RLS pass.
revoke execute on function public.settle_order(uuid) from public;
revoke execute on function public.expire_stale_offers() from public;
revoke execute on function public.auto_dispatch_ready_orders() from public;
revoke execute on function public.offer_order_to_rider(uuid, uuid, boolean) from public;
revoke execute on function public.dispatch_candidates(uuid, integer) from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.pause_store(uuid, integer, text) from public;
revoke execute on function public.resume_store(uuid) from public;
revoke execute on function public.update_platform_setting(text, jsonb, text) from public;
revoke execute on function public.update_service_zone(uuid, boolean, integer, numeric, integer, boolean, text) from public;

-- 0015 - rider onboarding.
revoke execute on function public.submit_rider_application(public.vehicle_type, text, uuid, date, text, text, text, text, text, text, text, text, boolean) from public;
revoke execute on function public.review_rider_document(uuid, boolean, text) from public;
revoke execute on function public.verify_rider(uuid) from public;

-- 0016 - merchant approval.
revoke execute on function public.merchant_location_latlng(uuid) from public;
revoke execute on function public.update_merchant_address(uuid, text, text, text, text, text, double precision, double precision) from public;
revoke execute on function public.submit_merchant_for_review(uuid) from public;
revoke execute on function public.review_merchant_document(uuid, boolean, text) from public;
revoke execute on function public.approve_merchant(uuid) from public;
revoke execute on function public.reject_merchant(uuid, text) from public;

-- 0017 - document expiry.
revoke execute on function public.expire_stale_documents() from public;

-- 0018 - suspension.
revoke execute on function public.suspend_merchant(uuid, text) from public;
revoke execute on function public.reactivate_merchant(uuid) from public;
revoke execute on function public.suspend_rider(uuid, text) from public;
revoke execute on function public.unsuspend_rider(uuid) from public;

-- 0019 - online payments.
revoke execute on function public.confirm_order_payment(uuid, text) from public;
revoke execute on function public.fail_order_payment(uuid, text) from public;
revoke execute on function public.expire_stale_pending_payments() from public;

-- 0020 - address geocoding helper.
revoke execute on function public.address_location_latlng(uuid) from public;

-- 0022 - rate limiting.
revoke execute on function public.check_rate_limit(text, integer, integer) from public;
revoke execute on function public.clean_rate_limit_hits() from public;

-- 0023 - payout encryption.
revoke execute on function public.payout_encryption_key() from public;
revoke execute on function public.decrypt_rider_payout_account(uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. confirm_order_payment/fail_order_payment - redefined to use
--    is_internal_session() (0010), the check dispatch_candidates already
--    uses for exactly this reason: current_setting('request.jwt.claims')
--    is only ever null for a genuine pg_cron/direct-SQL session, never for
--    a PostgREST request, anon key or not.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_order_payment(p_order_id uuid, p_provider_payment_id text)
returns public.orders
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not public.is_internal_session() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'That order no longer exists.' using errcode = 'P0002';
  end if;

  if v_order.payment_status = 'paid' then
    return v_order;
  end if;

  update public.orders
  set payment_status = 'paid',
      provider_payment_id = p_provider_payment_id,
      status = case when status = 'pending_payment' then 'placed' else status end
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.fail_order_payment(p_order_id uuid, p_reason text)
returns public.orders
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not public.is_internal_session() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'That order no longer exists.' using errcode = 'P0002';
  end if;

  if v_order.payment_status in ('paid', 'failed') or v_order.status <> 'pending_payment' then
    return v_order;
  end if;

  update public.orders
  set payment_status = 'failed',
      status = 'cancelled',
      cancellation_reason = coalesce(p_reason, 'Payment failed.')
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. decrypt_rider_payout_account - redefined with a null-safe owner check.
--    `is distinct from` treats NULL as a real, comparable value instead of
--    making the whole condition unknown - the auth.uid() is null branch that
--    let an anon caller through the old `<>` check cannot happen here.
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
  if auth.uid() is null or (p_rider_id is distinct from auth.uid() and not public.is_admin()) then
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

-- ---------------------------------------------------------------------------
-- 4. Rotate the compromised key and re-encrypt everything with the new one,
--    in the same transaction as the access-control fix above - there is no
--    window where the old (exposed) key is still the one protecting live
--    data once this migration finishes.
-- ---------------------------------------------------------------------------
do $$
declare
  v_secret_id uuid;
  v_old_key   text;
  v_new_key   text;
begin
  select id, decrypted_secret into v_secret_id, v_old_key
  from vault.decrypted_secrets where name = 'payout_encryption_key';

  v_new_key := encode(extensions.gen_random_bytes(32), 'hex');

  update public.rider_applications
  set payout_account_number = extensions.pgp_sym_encrypt(
    extensions.pgp_sym_decrypt(payout_account_number, v_old_key), v_new_key
  )
  where payout_account_number is not null;

  update public.merchants
  set payout_account_number = extensions.pgp_sym_encrypt(
    extensions.pgp_sym_decrypt(payout_account_number, v_old_key), v_new_key
  )
  where payout_account_number is not null;

  -- name passed explicitly rather than relying on it defaulting to "leave
  -- unchanged" when omitted - payout_encryption_key() looks the secret up
  -- by this exact name, and this migration is not the place to find out
  -- vault.update_secret clears it instead.
  perform vault.update_secret(v_secret_id, v_new_key, 'payout_encryption_key');
end $$;
