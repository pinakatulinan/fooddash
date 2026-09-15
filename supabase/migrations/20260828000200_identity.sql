-- ============================================================================
-- 0002  Identity: profiles, addresses, notifications, platform settings
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles - one row per auth.users row, created automatically on signup.
-- auth.users is owned by Supabase and cannot carry app columns, so every
-- application-level fact about a person lives here.
-- ----------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  role              public.user_role not null default 'customer',
  full_name         text,
  phone             text,
  email             extensions.citext,
  avatar_url        text,
  -- PH mobile numbers are the real identity here; email is often secondary.
  phone_verified_at timestamptz,
  is_blocked        boolean not null default false,
  blocked_reason    text,
  locale            text not null default 'en-PH',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint profiles_phone_format check (
    phone is null or phone ~ '^\+63[0-9]{10}$'
  )
);

create unique index profiles_phone_key on public.profiles (phone) where phone is not null;
create index profiles_role_idx on public.profiles (role);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

comment on column public.profiles.role is
  'Platform-level role. Merchant staff membership is separate (merchant_members) because one user can work for several stores.';

-- Mirror new auth users into profiles. Runs as definer because the trigger
-- fires in the auth schema where the caller has no rights on public.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    -- The client may request a role at signup, but only these three are
    -- self-serve. 'admin' and 'support' are granted by an existing admin only.
    case new.raw_user_meta_data ->> 'role'
      when 'merchant' then 'merchant'::public.user_role
      when 'rider'    then 'rider'::public.user_role
      else 'customer'::public.user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- addresses - saved customer delivery addresses.
--
-- PH addresses are unreliable as free text, so the map pin is the source of
-- truth for routing and the text is what the rider reads. `landmark` is not
-- decoration: it is how riders actually find the door.
-- ----------------------------------------------------------------------------
create table public.addresses (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  label           text not null default 'Home',
  recipient_name  text,
  recipient_phone text,
  line1           text not null,
  barangay        text,
  city            text not null,
  province        text,
  postal_code     text,
  landmark        text,
  delivery_notes  text,
  location        extensions.geography(point, 4326) not null,
  is_default      boolean not null default false,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index addresses_user_idx on public.addresses (user_id) where archived_at is null;
create index addresses_location_idx on public.addresses using gist (location);
-- At most one default per user, enforced by the database rather than by hope.
create unique index addresses_one_default_per_user
  on public.addresses (user_id) where is_default and archived_at is null;

create trigger addresses_touch before update on public.addresses
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- notifications - in-app inbox. Push delivery is a separate concern handled by
-- an Edge Function reading push_subscriptions.
-- ----------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc) where read_at is null;

create table public.push_subscriptions (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth_key   text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- platform_settings - operational knobs that must change without a deploy:
-- dispatch mode, fee formula, offer timeout, COD cash caps.
-- ----------------------------------------------------------------------------
create table public.platform_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);

create trigger platform_settings_touch before update on public.platform_settings
  for each row execute function public.touch_updated_at();

insert into public.platform_settings (key, value, description) values
  ('dispatch_mode', '"manual"'::jsonb,
   'manual = ops assigns riders by hand; auto = nearest-rider offer loop. Start manual.'),
  ('dispatch_offer_seconds', '45'::jsonb,
   'How long a rider has to accept an offer before it expires and moves to the next.'),
  ('dispatch_search_radius_m', '5000'::jsonb,
   'Maximum straight-line distance from the store when looking for riders.'),
  ('default_commission_rate', '0.15'::jsonb,
   'Platform cut of the food subtotal for new merchants (15%).'),
  ('service_fee_rate', '0.00'::jsonb,
   'Customer-facing platform fee. Zero at launch: small merchants need volume first.'),
  ('rider_cash_cap_centavos', '300000'::jsonb,
   'COD cash a rider may hold (PHP 3,000.00) before being blocked from new orders.'),
  ('currency', '"PHP"'::jsonb,
   'ISO code. All monetary amounts in this schema are integer centavos.'),
  ('accepting_signups', 'true'::jsonb,
   'Global kill switch for new merchant and rider signups.');

-- ----------------------------------------------------------------------------
-- admin_audit_log - every privileged action. Append-only by policy; there is
-- deliberately no UPDATE or DELETE policy for anyone, including admins.
-- ----------------------------------------------------------------------------
create table public.admin_audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles(id),
  action      text not null,
  entity_type text not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  note        text,
  created_at  timestamptz not null default now()
);

create index admin_audit_log_entity_idx
  on public.admin_audit_log (entity_type, entity_id, created_at desc);
