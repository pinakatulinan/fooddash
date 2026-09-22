-- ============================================================================
-- 0017  Document expiry sweep, and closing the gap it exposed on the
--       merchant side: permit uploads never asked for an expiry date at all.
-- ----------------------------------------------------------------------------
-- 'expired' has been a document_status value since 0003 and nothing has ever
-- set it. verify_rider() (0015) already treats an approved-but-past-expiry
-- rider document as not good enough when a rider re-applies, but a rider
-- verified before their license lapsed stays is_verified with no signal
-- anywhere that the document itself is now stale - the row still reads
-- 'approved'. approve_merchant() had the same blind spot, made worse by
-- merchant_documents_insert never collecting expires_at in the first place,
-- so every permit was stored as if it never expired.
--
-- This does not auto-unverify a rider or un-approve a store - that is a
-- judgement call for ops, not something a nightly sweep should decide.
-- It flips the document to 'expired' so it is visible (both admin detail
-- pages already render that status - status-pill and page 0015/0016 wiring
-- needed no changes) and so verify_rider/approve_merchant correctly refuse
-- to treat it as current if either is ever run again for that rider or store.
-- ============================================================================

create or replace function public.expire_stale_documents()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with r as (
    update public.rider_documents
    set status = 'expired'
    where status = 'approved' and expires_at is not null and expires_at < current_date
    returning 1
  ),
  m as (
    update public.merchant_documents
    set status = 'expired'
    where status = 'approved' and expires_at is not null and expires_at < current_date
    returning 1
  )
  select (select count(*) from r) + (select count(*) from m) into v_count;

  return v_count;
end;
$$;

revoke execute on function public.expire_stale_documents() from anon, authenticated;

-- Once a day is plenty for a date-granularity check - unlike offer expiry
-- (0008), nothing here is racing a courier waiting on a job.
select cron.schedule('expire-stale-documents', '0 16 * * *', $$select public.expire_stale_documents()$$);

-- ---------------------------------------------------------------------------
-- approve_merchant now refuses an approved-but-expired document the same way
-- verify_rider already does, so redefine it with that one extra condition.
-- ---------------------------------------------------------------------------
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
      where x.merchant_id = p_merchant_id
        and x.doc_type = d
        and x.status = 'approved'
        and (x.expires_at is null or x.expires_at >= current_date)
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
