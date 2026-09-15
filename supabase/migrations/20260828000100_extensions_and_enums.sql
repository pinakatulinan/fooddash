-- ============================================================================
-- 0001  Extensions and enums
-- ----------------------------------------------------------------------------
-- Everything downstream depends on this file. Enums are used instead of text
-- columns so that an invalid state is impossible to write, not merely unusual.
-- ============================================================================

create extension if not exists "uuid-ossp"  with schema extensions;
create extension if not exists "pgcrypto"   with schema extensions;
create extension if not exists "postgis"    with schema extensions;
create extension if not exists "citext"     with schema extensions;
-- Runs the dispatch loop and the stale-offer sweep on a schedule (0008) -
-- pg_cron owns its own `cron` schema regardless of the WITH SCHEMA clause.
create extension if not exists "pg_cron"    with schema extensions;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

-- A person's platform-level role. Merchant staff membership is modelled
-- separately in merchant_members, because one user may work for many stores.
create type public.user_role as enum (
  'customer',
  'merchant',
  'rider',
  'support',
  'admin'
);

create type public.merchant_status as enum (
  'draft',           -- owner is still filling in the profile
  'pending_review',  -- submitted, waiting on ops
  'approved',        -- live and orderable
  'suspended',       -- temporarily hidden by ops
  'rejected'
);

-- The order lifecycle. Transitions are enforced by a trigger in 0008.
create type public.order_status as enum (
  'draft',
  'pending_payment',   -- online payment initiated, awaiting provider confirmation
  'placed',            -- paid or COD-confirmed, waiting on the merchant
  'accepted',          -- merchant confirmed, prep clock started
  'preparing',
  'ready_for_pickup',
  'picked_up',         -- rider has the food
  'arrived',           -- rider at the customer's address
  'delivered',
  'cancelled',
  'failed'             -- undeliverable: nobody home, wrong address, rider incident
);

create type public.order_type as enum ('delivery', 'pickup');

create type public.payment_method as enum ('cod', 'gcash', 'maya', 'card');

create type public.payment_status as enum (
  'pending',
  'authorized',
  'paid',
  'failed',
  'refunded',
  'partially_refunded'
);

-- Rider availability. Only 'online_idle' riders are eligible for new offers.
create type public.rider_status as enum (
  'offline',
  'online_idle',
  'on_offer',              -- has a pending offer, not yet answered
  'en_route_to_store',
  'at_store',
  'en_route_to_customer',
  'unavailable'            -- online but blocked (break, cash cap reached)
);

create type public.assignment_status as enum (
  'offered',
  'accepted',
  'declined',
  'expired',
  'cancelled',
  'completed'
);

-- Manual = ops assigns by hand. Auto = nearest-rider offer loop.
-- Stored in platform_settings so it flips without a deploy.
create type public.dispatch_mode as enum ('manual', 'auto');

create type public.vehicle_type as enum ('motorcycle', 'bicycle', 'car', 'on_foot');

create type public.promo_type as enum ('percent_off', 'fixed_off', 'free_delivery');

-- Who absorbs the cost of a discount. Drives the payout maths.
create type public.promo_funder as enum ('platform', 'merchant', 'shared');

create type public.ledger_account_type as enum ('platform', 'merchant', 'rider', 'customer');

create type public.ledger_entry_type as enum (
  'order_sale',           -- gross value of the basket, credited to the merchant
  'platform_commission',  -- platform's cut, debited from the merchant
  'delivery_fee',         -- what the customer paid for delivery
  'rider_earning',        -- credited to the rider
  'tip',
  'promo_subsidy',        -- who ate the discount
  'refund',
  'adjustment',           -- manual correction by ops, always needs a note
  'cash_collected',       -- COD: rider now owes the platform this money
  'cash_remitted',        -- COD: rider handed it in
  'payout'
);

create type public.payout_status as enum ('scheduled', 'processing', 'paid', 'failed', 'on_hold');

create type public.document_status as enum ('pending', 'approved', 'rejected', 'expired');

create type public.ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');

-- ----------------------------------------------------------------------------
-- The one trigger function that has no table dependencies, so it can live here
-- and be attached by every table that follows.
-- ----------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
