-- ============================================================================
-- 0022  Rate limiting for login, signup, and password reset - the three
--       unauthenticated actions worth throttling (credential stuffing,
--       spam signups, and reset-email bombing, respectively).
-- ----------------------------------------------------------------------------
-- Backed by Postgres rather than an in-memory counter: a Next.js deployment
-- can run as several short-lived, independent instances, and an in-memory
-- Map resets per instance - the same reason every other piece of shared
-- state in this app (dispatch, offer expiry, document expiry) already lives
-- in the database instead of application memory.
--
-- Never exposed to anon/authenticated - this is called only from inside the
-- (auth) server actions, via the service role, before a session exists to
-- gate it any other way. Same shape as expire_stale_offers/
-- expire_stale_documents: an internal mechanism, not something a client
-- calls directly.
-- ============================================================================

create table public.rate_limit_hits (
  key    text not null,
  bucket timestamptz not null,
  count  integer not null default 1,
  primary key (key, bucket)
);

alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;

create or replace function public.check_rate_limit(
  p_key            text,
  p_max_attempts   integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  -- Fixed windows, not a sliding log: cheap (one row per key per window
  -- instead of one per attempt) and close enough for "slow this down," which
  -- is the actual goal - nobody needs a precise leaky bucket to stop a
  -- password-guessing loop.
  v_bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count  integer;
begin
  insert into public.rate_limit_hits (key, bucket, count)
  values (p_key, v_bucket, 1)
  on conflict (key, bucket) do update set count = rate_limit_hits.count + 1
  returning count into v_count;

  return v_count <= p_max_attempts;
end;
$$;

revoke execute on function public.check_rate_limit(text, integer, integer) from anon, authenticated;

-- Daily sweep - old buckets are worthless the moment their window passes,
-- but there is no urgency to clean them the way an active offer has.
create or replace function public.clean_rate_limit_hits()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with deleted as (
    delete from public.rate_limit_hits where bucket < now() - interval '1 day'
    returning 1
  )
  select count(*) from deleted into v_count;

  return v_count;
end;
$$;

revoke execute on function public.clean_rate_limit_hits() from anon, authenticated;

select cron.schedule('clean-rate-limit-hits', '0 3 * * *', $$select public.clean_rate_limit_hits()$$);
