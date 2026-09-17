-- ============================================================================
-- 0013  order_messages - a direct channel between a customer and whichever
--       rider is actually carrying their order.
-- ----------------------------------------------------------------------------
-- Deliberately separate from support_messages: that table is a staff-facing
-- ticket thread with an is_internal flag and admin routing. This is a private
-- two-party channel for one delivery, gone from relevance once no assignment
-- ties the two people together - it has no business being visible to a
-- merchant or an ops admin the way a support ticket does.
-- ============================================================================

create table public.order_messages (
  id         uuid primary key default extensions.gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),

  constraint order_messages_body_not_blank check (char_length(trim(body)) between 1 and 1000)
);

create index order_messages_order_idx on public.order_messages (order_id, created_at);

alter table public.order_messages enable row level security;

-- Visible to the customer and to whoever has ever actually carried this
-- order (not just 'accepted' - a completed delivery's chat should stay
-- readable afterwards, same as the order itself does).
create policy order_messages_participants_read on public.order_messages
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          o.customer_id = auth.uid()
          or exists (
            select 1 from public.delivery_assignments a
            where a.order_id = o.id
              and a.rider_id = auth.uid()
              and a.status in ('accepted', 'completed')
          )
        )
    )
  );

-- Writable only while a rider is actually actively carrying it - there is no
-- one on the other end to message once it is not.
create policy order_messages_participants_write on public.order_messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          o.customer_id = auth.uid()
          or exists (
            select 1 from public.delivery_assignments a
            where a.order_id = o.id and a.rider_id = auth.uid() and a.status = 'accepted'
          )
        )
    )
  );

alter publication supabase_realtime add table public.order_messages;

-- ----------------------------------------------------------------------------
-- order_tracking (0011) already returns the rider's first name, avatar,
-- vehicle, plate and live position to the customer - phone was withheld
-- because nothing on the customer side could do anything with it yet. Now
-- that it can (a Call button), it belongs in the same enumerated object
-- order_tracking's own comment already explains the reasoning for: exactly
-- the fields a customer needs, never a raw profile join.
-- ----------------------------------------------------------------------------
create or replace function public.order_tracking(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_order  public.orders;
  v_rider  uuid;
  v_card   jsonb := null;
begin
  if not public.can_view_order(p_order_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  v_rider := public.current_rider_for_order(p_order_id);

  if v_rider is not null then
    select jsonb_build_object(
      'rider_id', r.id,
      'first_name', split_part(coalesce(p.full_name, 'Your rider'), ' ', 1),
      'avatar_url', p.avatar_url,
      'phone', p.phone,
      'vehicle', r.vehicle,
      'plate_number', r.plate_number,
      'rating_avg', r.rating_avg,
      'lat', extensions.st_y(r.current_location::extensions.geometry),
      'lng', extensions.st_x(r.current_location::extensions.geometry),
      'last_ping_at', r.last_ping_at
    )
    into v_card
    from public.riders r
    join public.profiles p on p.id = r.id
    where r.id = v_rider;
  end if;

  return jsonb_build_object(
    'order_id',     v_order.id,
    'code',         v_order.code,
    'status',       v_order.status,
    'type',         v_order.type,
    'placed_at',    v_order.placed_at,
    'promised_at',  v_order.promised_at,
    'eta_minutes',  v_order.eta_minutes,
    'total_centavos', v_order.total_centavos,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'pod_code',     case when v_order.customer_id = auth.uid()
                              and v_order.status in ('picked_up', 'arrived')
                         then v_order.pod_code end,
    'merchant', (
      select jsonb_build_object('id', m.id, 'name', m.name, 'logo_url', m.logo_url,
                                'phone', m.phone,
                                'lat', extensions.st_y(m.location::extensions.geometry),
                                'lng', extensions.st_x(m.location::extensions.geometry))
      from public.merchants m where m.id = v_order.merchant_id
    ),
    'dropoff', jsonb_build_object(
      'address', v_order.delivery_address,
      'lat', extensions.st_y(v_order.dropoff_location::extensions.geometry),
      'lng', extensions.st_x(v_order.dropoff_location::extensions.geometry)
    ),
    'rider', v_card,
    'timeline', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'status', e.to_status, 'at', e.created_at, 'note', e.note
             ) order by e.created_at), '[]'::jsonb)
      from public.order_events e where e.order_id = p_order_id
    )
  );
end;
$$;
