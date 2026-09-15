-- ============================================================================
-- 0006b  Promos, payments, the ledger, and payouts
-- ----------------------------------------------------------------------------
-- Money moves through three layers and they are kept strictly separate:
--   payments        - what a provider (PayMongo/Xendit) told us happened
--   ledger_entries  - what each party earned or owes, in our own books
--   payouts         - what we actually sent out, and when
-- Collapsing these into one table is the usual mistake; it makes "the provider
-- says paid but the merchant was never credited" impossible to even express.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- promos
-- ----------------------------------------------------------------------------
create table public.promos (
  id             uuid primary key default extensions.gen_random_uuid(),
  code           extensions.citext not null unique,
  description    text,
  type           public.promo_type not null,
  -- percent_off: 10.00 means 10%. fixed_off / free_delivery: centavos cap.
  value          numeric(10, 2) not null default 0,
  max_discount_centavos integer,
  min_order_centavos    integer not null default 0,

  -- Null merchant_id = platform-wide. Set = valid at that store only.
  merchant_id    uuid references public.merchants(id) on delete cascade,
  funded_by      public.promo_funder not null default 'platform',
  merchant_share numeric(5, 4) not null default 0,

  starts_at      timestamptz not null default now(),
  ends_at        timestamptz,
  usage_limit    integer,
  per_user_limit integer not null default 1,
  -- Maintained by trigger; makes the "limit reached" check a single read.
  usage_count    integer not null default 0,

  first_order_only boolean not null default false,
  is_active      boolean not null default true,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint promos_share_range check (merchant_share between 0 and 1),
  constraint promos_window check (ends_at is null or ends_at > starts_at)
);

create index promos_active_idx on public.promos (code) where is_active;

create trigger promos_touch before update on public.promos
  for each row execute function public.touch_updated_at();

-- Now that promos exists, close the loop from orders.
alter table public.orders
  add constraint orders_promo_fk
  foreign key (promo_id) references public.promos(id) on delete set null;

create table public.promo_redemptions (
  id                uuid primary key default extensions.gen_random_uuid(),
  promo_id          uuid not null references public.promos(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  order_id          uuid not null references public.orders(id) on delete cascade,
  discount_centavos integer not null,
  created_at        timestamptz not null default now(),
  -- One redemption row per order, so a retry cannot double-count usage.
  unique (order_id)
);

create index promo_redemptions_user_idx on public.promo_redemptions (promo_id, user_id);

create or replace function public.bump_promo_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.promos set usage_count = usage_count + 1 where id = new.promo_id;
  elsif tg_op = 'DELETE' then
    update public.promos set usage_count = greatest(usage_count - 1, 0) where id = old.promo_id;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger promo_redemptions_bump_usage
  after insert or delete on public.promo_redemptions
  for each row execute function public.bump_promo_usage();

-- ----------------------------------------------------------------------------
-- payments - one row per attempt against a provider. An order may have several
-- (customer retries a failed GCash charge), which is why this is not a column
-- on orders.
-- ----------------------------------------------------------------------------
create table public.payments (
  id             uuid primary key default extensions.gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete restrict,
  provider       text not null,          -- 'paymongo' | 'xendit' | 'cash'
  provider_ref   text,                   -- payment intent / charge id
  method         public.payment_method not null,
  amount_centavos integer not null,
  status         public.payment_status not null default 'pending',
  -- The client is given this to redirect into GCash/Maya; it is not a secret,
  -- but it does expire.
  checkout_url   text,
  failure_code   text,
  failure_message text,
  -- Full provider response, kept verbatim. When a dispute lands six months
  -- later, the raw payload is the only thing that settles it.
  raw_response   jsonb,
  paid_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index payments_order_idx on public.payments (order_id, created_at desc);
create unique index payments_provider_ref_key on public.payments (provider, provider_ref)
  where provider_ref is not null;

create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- payment_webhook_events - idempotency ledger for provider callbacks.
--
-- Providers retry aggressively and deliver out of order. The unique constraint
-- on (provider, event_id) is what stops a double-delivered "payment.paid"
-- from crediting a merchant twice. The Edge Function inserts here FIRST and
-- bails on conflict.
-- ----------------------------------------------------------------------------
create table public.payment_webhook_events (
  id           uuid primary key default extensions.gen_random_uuid(),
  provider     text not null,
  event_id     text not null,
  event_type   text,
  payload      jsonb not null,
  processed_at timestamptz,
  process_error text,
  received_at  timestamptz not null default now(),
  unique (provider, event_id)
);

create index payment_webhook_events_unprocessed_idx on public.payment_webhook_events (received_at)
  where processed_at is null;

create table public.refunds (
  id              uuid primary key default extensions.gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete restrict,
  payment_id      uuid references public.payments(id) on delete set null,
  amount_centavos integer not null,
  reason          text not null,
  -- Who absorbs it: 'platform', 'merchant', 'rider'. Drives the ledger entries.
  liable_party    public.ledger_account_type not null default 'platform',
  status          public.payment_status not null default 'pending',
  provider_ref    text,
  requested_by    uuid references public.profiles(id),
  approved_by     uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,

  constraint refunds_amount_positive check (amount_centavos > 0)
);

create index refunds_order_idx on public.refunds (order_id);

-- ----------------------------------------------------------------------------
-- ledger_entries - append-only. Nothing in this table is ever updated or
-- deleted; a correction is a new entry of type 'adjustment' with a note.
--
-- Sign convention: positive = the account is owed money, negative = the
-- account owes money. A merchant's balance is the sum of their entries.
-- ----------------------------------------------------------------------------
create table public.ledger_entries (
  id           bigint generated always as identity primary key,
  account_type public.ledger_account_type not null,
  account_id   uuid,                      -- null for the platform's own account
  order_id     uuid references public.orders(id) on delete set null,
  entry_type   public.ledger_entry_type not null,
  amount_centavos integer not null,
  note         text,
  created_by   uuid references public.profiles(id),
  payout_id    uuid,
  created_at   timestamptz not null default now()
);

create index ledger_entries_account_idx on public.ledger_entries (account_type, account_id, created_at desc);
create index ledger_entries_order_idx on public.ledger_entries (order_id);
create index ledger_entries_unsettled_idx on public.ledger_entries (account_type, account_id)
  where payout_id is null;

comment on table public.ledger_entries is
  'Append-only. Corrections are new adjustment entries, never edits. Balance = sum(amount_centavos).';

create table public.payouts (
  id            uuid primary key default extensions.gen_random_uuid(),
  payee_type    public.ledger_account_type not null,
  payee_id      uuid not null,
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  gross_centavos integer not null default 0,
  deductions_centavos integer not null default 0,
  net_centavos  integer not null default 0,
  status        public.payout_status not null default 'scheduled',
  method        text,
  reference     text,
  note          text,
  processed_by  uuid references public.profiles(id),
  processed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index payouts_payee_idx on public.payouts (payee_type, payee_id, period_end desc);

create trigger payouts_touch before update on public.payouts
  for each row execute function public.touch_updated_at();

alter table public.ledger_entries
  add constraint ledger_entries_payout_fk
  foreign key (payout_id) references public.payouts(id) on delete set null;

-- ----------------------------------------------------------------------------
-- rider_remittances - COD reconciliation. The rider collects cash on our
-- behalf and hands it in; until they do, riders.cash_on_hand_centavos is a
-- real receivable.
-- ----------------------------------------------------------------------------
create table public.rider_remittances (
  id              uuid primary key default extensions.gen_random_uuid(),
  rider_id        uuid not null references public.riders(id) on delete restrict,
  amount_centavos integer not null,
  method          text,          -- 'cash_to_office' | 'bank_deposit' | 'gcash'
  reference       text,
  proof_path      text,
  received_by     uuid references public.profiles(id),
  received_at     timestamptz,
  created_at      timestamptz not null default now(),

  constraint rider_remittances_amount_positive check (amount_centavos > 0)
);

create index rider_remittances_rider_idx on public.rider_remittances (rider_id, created_at desc);

-- ----------------------------------------------------------------------------
-- support_tickets - customer-reported problems, attached to an order when
-- there is one. The refund path starts here.
-- ----------------------------------------------------------------------------
create table public.support_tickets (
  id          uuid primary key default extensions.gen_random_uuid(),
  order_id    uuid references public.orders(id) on delete set null,
  raised_by   uuid not null references public.profiles(id) on delete cascade,
  category    text not null,   -- missing_item, late, wrong_order, rider_conduct, payment
  subject     text not null,
  body        text,
  status      public.ticket_status not null default 'open',
  assigned_to uuid references public.profiles(id),
  resolution  text,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index support_tickets_status_idx on public.support_tickets (status, created_at desc);
create index support_tickets_raiser_idx on public.support_tickets (raised_by, created_at desc);

create trigger support_tickets_touch before update on public.support_tickets
  for each row execute function public.touch_updated_at();

create table public.support_messages (
  id         uuid primary key default extensions.gen_random_uuid(),
  ticket_id  uuid not null references public.support_tickets(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  -- Internal notes are visible to staff only; the RLS policy in 0009 enforces it.
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);
