import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Dedicated, clearly-named test identities - never the accounts a real
 * person signs into. Provisioned once (idempotently) with the service-role
 * key, which exists in .env.local for exactly this kind of setup ("admin
 * actions, payment webhooks and the dispatch loop" per its own comment) and
 * bypasses RLS entirely. Every actual test assertion below this point goes
 * through the real anon-key + RLS path instead, the same way a real user or
 * a real attacker would reach it - fixture setup is scaffolding, not itself
 * something under test.
 */
const FIXTURE_PASSWORD = "QaFixture123!";

export const FIXTURE_EMAILS = {
  customer: "qa.customer@fooddash.test",
  merchant: "qa.merchant@fooddash.test",
  rider: "qa.rider@fooddash.test",
  // Reused rather than duplicated: admin is a role, not personal test data,
  // and this account already exists in the seed with a stable, known password.
  admin: "admin@fooddash.test",
  adminPassword: "password123",
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set - copy .env.local or export it before running tests.`);
  return value;
}

function serviceClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function anonClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
}

async function ensureAuthUser(email: string, fullName: string, role: string): Promise<string> {
  const probe = anonClient();
  const { error: signInErr, data: signInData } = await probe.auth.signInWithPassword({
    email,
    password: FIXTURE_PASSWORD,
  });
  if (!signInErr) return signInData.user!.id;

  const svc = serviceClient();
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: FIXTURE_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  });
  if (error) throw error;
  return data.user.id;
}

export interface Fixtures {
  customerId: string;
  merchantUserId: string;
  riderUserId: string;
  merchantId: string;
  itemId: string;
  addressId: string;
  /** Any active service zone - rider applications must name one. */
  zoneId: string;
}

let cached: Fixtures | null = null;

/** Idempotent - safe to call at the top of every test file. */
export async function ensureFixtures(): Promise<Fixtures> {
  if (cached) return cached;

  const customerId = await ensureAuthUser(FIXTURE_EMAILS.customer, "QA Customer", "customer");
  const merchantUserId = await ensureAuthUser(FIXTURE_EMAILS.merchant, "QA Merchant", "merchant");
  const riderUserId = await ensureAuthUser(FIXTURE_EMAILS.rider, "QA Rider", "rider");

  const svc = serviceClient();

  let addressId: string;
  {
    const { data: existing } = await svc
      .from("addresses")
      .select("id")
      .eq("user_id", customerId)
      .eq("label", "QA Fixture")
      .maybeSingle();
    if (existing) {
      addressId = existing.id;
    } else {
      const { data, error } = await svc
        .from("addresses")
        .insert({
          user_id: customerId,
          label: "QA Fixture",
          recipient_name: "QA Customer",
          recipient_phone: "09170000000",
          line1: "123 QA Test Street",
          barangay: "Lahug",
          city: "Cebu City",
          province: "Cebu",
          location: "SRID=4326;POINT(123.9 10.31)",
        })
        .select("id")
        .single();
      if (error) throw error;
      addressId = data.id;
    }
  }

  let merchantId: string;
  {
    const { data: existingMember } = await svc
      .from("merchant_members")
      .select("merchant_id")
      .eq("user_id", merchantUserId)
      .maybeSingle();
    if (existingMember) {
      merchantId = existingMember.merchant_id;
    } else {
      const { data: store, error } = await svc
        .from("merchants")
        .insert({
          slug: `qa-fixture-kitchen-${Date.now()}`,
          name: "QA Fixture Kitchen",
          status: "approved",
          is_accepting_orders: true,
          commission_rate: 0.15,
          line1: "1 QA Store Street",
          barangay: "Lahug",
          city: "Cebu City",
          province: "Cebu",
          location: "SRID=4326;POINT(123.905 10.32)",
        })
        .select("id")
        .single();
      if (error) throw error;
      merchantId = store.id;

      await svc.from("merchant_members").insert({ merchant_id: merchantId, user_id: merchantUserId, is_owner: true });

      // Open every day, all day - a test asserting order placement should
      // never fail because of what time the suite happened to run.
      await svc.from("merchant_hours").insert(
        Array.from({ length: 7 }, (_, day_of_week) => ({
          merchant_id: merchantId,
          day_of_week,
          opens_at: "00:00:00",
          closes_at: "23:59:59",
        })),
      );
    }
  }

  let itemId: string;
  {
    const { data: existing } = await svc
      .from("menu_items")
      .select("id")
      .eq("merchant_id", merchantId)
      .eq("name", "QA Test Meal")
      .maybeSingle();
    if (existing) {
      itemId = existing.id;
    } else {
      const { data, error } = await svc
        .from("menu_items")
        .insert({
          merchant_id: merchantId,
          name: "QA Test Meal",
          base_price_centavos: 15000,
          is_available: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      itemId = data.id;
    }
  }

  {
    const { data: existing } = await svc.from("riders").select("id").eq("id", riderUserId).maybeSingle();
    const riderFields = {
      vehicle: "motorcycle",
      is_verified: true,
      is_suspended: false,
      status: "online_idle",
      current_location: "SRID=4326;POINT(123.905 10.32)",
      last_ping_at: new Date().toISOString(),
    };
    if (existing) {
      await svc.from("riders").update(riderFields).eq("id", riderUserId);
    } else {
      await svc.from("riders").insert({ id: riderUserId, ...riderFields });
    }
  }

  const { data: zone, error: zoneError } = await svc
    .from("service_zones")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .single();
  if (zoneError) throw zoneError;

  cached = { customerId, merchantUserId, riderUserId, merchantId, itemId, addressId, zoneId: zone.id };
  return cached;
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in as ${email} failed: ${error.message}`);
  return client;
}

export const customerClient = () => signIn(FIXTURE_EMAILS.customer, FIXTURE_PASSWORD);
export const merchantClient = () => signIn(FIXTURE_EMAILS.merchant, FIXTURE_PASSWORD);
export const riderClient = () => signIn(FIXTURE_EMAILS.rider, FIXTURE_PASSWORD);
export const adminClient = () => signIn(FIXTURE_EMAILS.admin, FIXTURE_EMAILS.adminPassword);

/** Places one real order through the real RPCs a customer's checkout uses. */
export async function placeTestOrder(fx: Fixtures): Promise<{ orderId: string; customer: SupabaseClient }> {
  const customer = await customerClient();
  const { data: cartId, error: cartErr } = await customer.rpc("add_to_cart", {
    p_menu_item_id: fx.itemId,
    p_quantity: 1,
    p_option_ids: [],
    p_notes: null,
    p_replace_cart: true,
  });
  if (cartErr) throw new Error(`add_to_cart: ${cartErr.message}`);

  const { error: priceErr } = await customer.rpc("price_cart", {
    p_cart_id: cartId,
    p_address_id: fx.addressId,
    p_promo_code: null,
  });
  if (priceErr) throw new Error(`price_cart: ${priceErr.message}`);

  const { data: orderId, error: placeErr } = await customer.rpc("place_order", {
    p_cart_id: cartId,
    p_address_id: fx.addressId,
    p_payment_method: "cod",
    p_promo_code: null,
    p_tip_centavos: 0,
  });
  if (placeErr) throw new Error(`place_order: ${placeErr.message}`);

  return { orderId: orderId as string, customer };
}

/** Best-effort - test orders are timestamped away by row age if this is ever skipped. */
export async function deleteOrders(orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  const svc = serviceClient();
  await svc.from("orders").delete().in("id", orderIds);
}
