-- ============================================================================
-- 0019  Online payments: the PayMongo side of a path the schema already
--       anticipated.
-- ----------------------------------------------------------------------------
-- 'pending_payment' has been in order_status since 0005 ("online payment
-- initiated, awaiting provider confirmation"), the pending_payment ->
-- placed/cancelled/failed transitions have been legal since 0008, the
-- customer's cancel button already treats pending_payment as cancellable,
-- and checkout-form.tsx has shown gcash/maya as "coming soon" the whole
-- time. Nothing about order state needed to change - only a way for a
-- payment provider (arriving with no user session, service-role only, same
-- as every other webhook in this codebase) to say "this one cleared" or
-- "this one didn't".
-- ============================================================================

alter table public.orders
  add column provider_payment_id text,
  add column payment_checkout_url text;

-- One row per webhook delivery, keyed by PayMongo's own event id. PayMongo
-- retries a webhook that doesn't answer fast, so the handler inserts here
-- before doing anything else - a replay of the same event id hits this
-- primary key and is treated as already handled, not a second confirmation.
create table public.payment_events (
  id         text primary key,
  order_id   uuid references public.orders(id) on delete set null,
  event_type text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon, authenticated;
-- No policies at all: only the service-role webhook handler ever touches
-- this table, and that key bypasses RLS entirely.

-- ---------------------------------------------------------------------------
-- confirm_order_payment / fail_order_payment - the only two ways a
-- provider's answer reaches an order. Both are plain updates; the existing
-- orders_guard_transition and orders_log_event triggers (0008) do the actual
-- enforcement and audit trail; there is nothing left for these functions to
-- duplicate.
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
  if auth.uid() is not null then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'That order no longer exists.' using errcode = 'P0002';
  end if;

  -- Already handled by an earlier delivery of the same event, or a
  -- COD order that could never have been pending_payment. Idempotent no-op.
  if v_order.payment_status = 'paid' then
    return v_order;
  end if;

  -- Deliberately does not resurrect an order that moved on without this
  -- payment - expire_stale_pending_payments (below) or the customer's own
  -- cancel button can both get there first if a "paid" event arrives late.
  -- payment_status still flips to 'paid' so the money showing up is on
  -- record (someone needs to refund it), but status is only ever advanced
  -- out of 'pending_payment', never out of whatever it already moved to.
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
  if auth.uid() is not null then
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

revoke execute on function public.confirm_order_payment(uuid, text) from anon, authenticated;
revoke execute on function public.fail_order_payment(uuid, text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- expire_stale_pending_payments - a customer who opens the PayMongo page and
-- never finishes (closes the tab, changes their mind) leaves an order in
-- pending_payment with no webhook ever coming. They can already cancel it
-- themselves (cancel-order.tsx treats pending_payment as cancellable), but
-- nothing cleaned it up if they just walk away. Same shape as
-- expire_stale_offers (0008) and expire_stale_documents (0017): a cron-only
-- sweep, not reachable through the API.
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_pending_payments()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.orders
    set status = 'cancelled', cancellation_reason = 'Payment window expired.'
    where status = 'pending_payment' and created_at < now() - interval '30 minutes'
    returning 1
  )
  select count(*) from expired into v_count;

  return v_count;
end;
$$;

revoke execute on function public.expire_stale_pending_payments() from anon, authenticated;

select cron.schedule('expire-stale-pending-payments', '*/5 * * * *', $$select public.expire_stale_pending_payments()$$);
