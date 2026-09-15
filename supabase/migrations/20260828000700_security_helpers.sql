-- ============================================================================
-- 0007  Security helpers
-- ----------------------------------------------------------------------------
-- These must be created AFTER the tables they read, because Postgres validates
-- SQL function bodies at CREATE time. They are the single source of truth for
-- "who is this caller" and are the only thing the RLS policies in 0009 ask.
-- ============================================================================

-- All are STABLE + SECURITY DEFINER so they can read profiles without being
-- caught by the very policies they are used to evaluate (which would recurse).
-- search_path is pinned on every definer function: without it, a caller can
-- shadow `public` and hijack the function body.
-- ----------------------------------------------------------------------------

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('admin', 'support') from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- True when the caller belongs to this merchant in any capacity.
create or replace function public.is_merchant_member(p_merchant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.merchant_members m
    where m.merchant_id = p_merchant_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_merchant_owner(p_merchant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.merchant_members m
    where m.merchant_id = p_merchant_id
      and m.user_id = auth.uid()
      and m.is_owner
  );
$$;

create or replace function public.is_rider()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.riders r where r.id = auth.uid());
$$;
