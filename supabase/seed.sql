-- ============================================================================
-- Seed data for local development (`supabase db reset` runs this automatically).
--
-- Creates five signed-in-able accounts, one service zone over Quezon City, and
-- three merchants with real menus - enough to exercise discovery, checkout,
-- the merchant console and dispatch without clicking anything into existence.
--
-- Every account uses the password: password123
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Auth users. Inserting into auth.users directly is only sane in local dev;
-- in staging and production, accounts are created through the Auth API.
-- ----------------------------------------------------------------------------
do $$
declare
  v_users constant jsonb := jsonb_build_array(
    jsonb_build_object('id', '11111111-1111-4111-8111-111111111111', 'email', 'customer@fooddash.test', 'name', 'Ana Reyes',       'role', 'customer', 'phone', '+639171110001'),
    jsonb_build_object('id', '22222222-2222-4222-8222-222222222222', 'email', 'merchant@fooddash.test', 'name', 'Lito Bautista',   'role', 'merchant', 'phone', '+639171110002'),
    jsonb_build_object('id', '33333333-3333-4333-8333-333333333333', 'email', 'rider@fooddash.test',    'name', 'Jomar Dela Cruz', 'role', 'rider',    'phone', '+639171110003'),
    jsonb_build_object('id', '44444444-4444-4444-8444-444444444444', 'email', 'admin@fooddash.test',    'name', 'Ops Admin',       'role', 'admin',    'phone', '+639171110004'),
    jsonb_build_object('id', '55555555-5555-4555-8555-555555555555', 'email', 'lola@fooddash.test',     'name', 'Fely Santos',     'role', 'merchant', 'phone', '+639171110005')
  );
  v_user jsonb;
begin
  for v_user in select * from jsonb_array_elements(v_users)
  loop
    -- The empty-string token columns are NOT optional. GoTrue is written in Go
    -- and scans them into plain string fields, so a NULL breaks sign-in with
    -- the deeply unhelpful "Database error querying schema".
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token,
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      (v_user ->> 'id')::uuid,
      'authenticated', 'authenticated',
      v_user ->> 'email',
      extensions.crypt('password123', extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_user ->> 'name', 'phone', v_user ->> 'phone', 'role', v_user ->> 'role'),
      '', '', '', '', '', '', '', '',
      now(), now()
    )
    on conflict (id) do nothing;

    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      v_user ->> 'id',
      (v_user ->> 'id')::uuid,
      jsonb_build_object('sub', v_user ->> 'id', 'email', v_user ->> 'email', 'email_verified', true),
      'email', now(), now(), now()
    )
    on conflict (provider, provider_id) do nothing;
  end loop;
end
$$;

-- handle_new_user() gave everyone a profile; the admin role is not self-serve
-- so it is set here explicitly.
update public.profiles set role = 'admin' where id = '44444444-4444-4444-8444-444444444444';

-- ----------------------------------------------------------------------------
-- Service zone: a rectangle over Quezon City / Metro Manila north.
-- ----------------------------------------------------------------------------
insert into public.service_zones (id, name, city, area, base_fee_centavos, base_distance_m, per_km_fee_centavos, max_fee_centavos, max_distance_m)
values (
  '99999999-9999-4999-8999-999999999999',
  'Quezon City Core', 'Quezon City',
  extensions.st_geogfromtext('POLYGON((120.98 14.58, 121.12 14.58, 121.12 14.74, 120.98 14.74, 120.98 14.58))'),
  4900, 2000, 1200, 20000, 8000
)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Customer address
-- ----------------------------------------------------------------------------
insert into public.addresses (id, user_id, label, line1, barangay, city, province, landmark, location, is_default)
values (
  'aaaaaaaa-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'Home', '24 Maginhawa Street', 'Teachers Village East', 'Quezon City', 'Metro Manila',
  'Blue gate beside the sari-sari store',
  extensions.st_setsrid(extensions.st_makepoint(121.0530, 14.6420), 4326)::extensions.geography,
  true
)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Merchants
-- ----------------------------------------------------------------------------
insert into public.merchants (
  id, slug, name, tagline, description, city, province, line1, barangay,
  location, status, is_accepting_orders, prep_time_minutes, min_order_centavos,
  commission_rate, phone, approved_at
) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'aling-nenas-carinderia',
   'Aling Nena''s Carinderia', 'Home-cooked ulam, all day',
   'A neighbourhood carinderia serving Filipino comfort food since 1998.',
   'Quezon City', 'Metro Manila', '18 Malingap Street', 'Teachers Village East',
   extensions.st_setsrid(extensions.st_makepoint(121.0495, 14.6395), 4326)::extensions.geography,
   'approved', true, 20, 15000, 0.1500, '+639181110011', now()),

  ('bbbbbbbb-0000-4000-8000-000000000002', 'kape-t-kwento',
   'Kape''t Kwento', 'Third-wave coffee, second-floor view',
   'Small-batch roasters pulling shots for the Maginhawa crowd.',
   'Quezon City', 'Metro Manila', '77 Maginhawa Street', 'Sikatuna Village',
   extensions.st_setsrid(extensions.st_makepoint(121.0561, 14.6448), 4326)::extensions.geography,
   'approved', true, 12, 10000, 0.1500, '+639181110012', now()),

  ('bbbbbbbb-0000-4000-8000-000000000003', 'lolas-lutong-bahay',
   'Lola''s Lutong Bahay', 'Silog and sisig, open late',
   'Open until 2am for the students and the night shift.',
   'Quezon City', 'Metro Manila', '5 Mother Ignacia Avenue', 'South Triangle',
   extensions.st_setsrid(extensions.st_makepoint(121.0335, 14.6355), 4326)::extensions.geography,
   'approved', true, 18, 12000, 0.1200, '+639181110013', now())
on conflict (id) do nothing;

insert into public.merchant_members (merchant_id, user_id, is_owner) values
  ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', true),
  ('bbbbbbbb-0000-4000-8000-000000000003', '55555555-5555-4555-8555-555555555555', true)
on conflict do nothing;

-- Opening hours: the carinderia and the coffee shop keep daytime hours; the
-- silog place closes at 2am, which exercises the closes_next_day path.
insert into public.merchant_hours (merchant_id, day_of_week, opens_at, closes_at, closes_next_day)
select m.id, d.dow, t.opens, t.closes, t.next_day
from (values
  ('bbbbbbbb-0000-4000-8000-000000000001'::uuid, '07:00'::time, '20:00'::time, false),
  ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, '07:00'::time, '19:00'::time, false),
  ('bbbbbbbb-0000-4000-8000-000000000003'::uuid, '17:00'::time, '02:00'::time, true)
) as t(merchant_id, opens, closes, next_day)
join public.merchants m on m.id = t.merchant_id
cross join generate_series(0, 6) as d(dow)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Menu: categories, items, and one fully-optioned item so the checkout
-- validation path has something real to chew on.
-- ----------------------------------------------------------------------------
insert into public.menu_categories (id, merchant_id, name, sort_order) values
  ('cccccccc-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'Ulam',        1),
  ('cccccccc-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'Rice & Sides', 2),
  ('cccccccc-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002', 'Espresso',     1),
  ('cccccccc-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000003', 'Silog Meals',  1)
on conflict (id) do nothing;

insert into public.menu_items (id, merchant_id, category_id, name, description, base_price_centavos, is_popular, sort_order) values
  ('dddddddd-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
   'Chicken Adobo', 'Slow-braised in soy, vinegar and plenty of garlic.', 12000, true, 1),
  ('dddddddd-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
   'Pork Sinigang', 'Sour tamarind broth with kangkong and radish.', 15000, true, 2),
  ('dddddddd-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002',
   'Extra Rice', 'One cup, steamed.', 2500, false, 1),
  ('dddddddd-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003',
   'Spanish Latte', 'Double shot, condensed milk, served hot or iced.', 15500, true, 1),
  ('dddddddd-0000-4000-8000-000000000005', 'bbbbbbbb-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000004',
   'Sisig Silog', 'Sizzling pork sisig, garlic rice, fried egg.', 17500, true, 1)
on conflict (id) do nothing;

insert into public.option_groups (id, menu_item_id, name, min_select, max_select, sort_order) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000004', 'Temperature', 1, 1, 1),
  ('eeeeeeee-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000004', 'Size',        1, 1, 2),
  ('eeeeeeee-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000004', 'Add-ons',     0, 3, 3),
  ('eeeeeeee-0000-4000-8000-000000000004', 'dddddddd-0000-4000-8000-000000000001', 'Rice',        1, 1, 1)
on conflict (id) do nothing;

insert into public.options (option_group_id, name, price_delta_centavos, is_default, sort_order) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'Hot',            0,    true,  1),
  ('eeeeeeee-0000-4000-8000-000000000001', 'Iced',           1000, false, 2),
  ('eeeeeeee-0000-4000-8000-000000000002', 'Regular',        0,    true,  1),
  ('eeeeeeee-0000-4000-8000-000000000002', 'Large',          3000, false, 2),
  ('eeeeeeee-0000-4000-8000-000000000003', 'Extra shot',     3500, false, 1),
  ('eeeeeeee-0000-4000-8000-000000000003', 'Oat milk',       3000, false, 2),
  ('eeeeeeee-0000-4000-8000-000000000003', 'Vanilla syrup',  2000, false, 3),
  ('eeeeeeee-0000-4000-8000-000000000004', 'Plain rice',     0,    true,  1),
  ('eeeeeeee-0000-4000-8000-000000000004', 'Garlic rice',    2000, false, 2),
  ('eeeeeeee-0000-4000-8000-000000000004', 'No rice',       -1500, false, 3)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Rider, verified and parked near the carinderia.
-- ----------------------------------------------------------------------------
insert into public.riders (
  id, vehicle, plate_number, status, is_verified, verified_at,
  home_zone_id, current_location, last_ping_at
) values (
  '33333333-3333-4333-8333-333333333333', 'motorcycle', 'NCR 1234', 'online_idle', true, now(),
  '99999999-9999-4999-8999-999999999999',
  extensions.st_setsrid(extensions.st_makepoint(121.0510, 14.6410), 4326)::extensions.geography,
  now()
)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Promos
-- ----------------------------------------------------------------------------
insert into public.promos (code, description, type, value, min_order_centavos, max_discount_centavos, first_order_only, funded_by)
values
  ('WELCOME50', 'PHP 50 off your first order', 'fixed_off',   5000,  20000, null, true,  'platform'),
  ('FREEDEL',   'Free delivery this weekend',  'free_delivery', 0,   25000, 10000, false, 'platform'),
  ('KAPE10',    '10% off at Kape''t Kwento',   'percent_off', 10.00, 15000, 5000, false, 'merchant')
on conflict (code) do nothing;

update public.promos
set merchant_id = 'bbbbbbbb-0000-4000-8000-000000000002', merchant_share = 1.0
where code = 'KAPE10';
