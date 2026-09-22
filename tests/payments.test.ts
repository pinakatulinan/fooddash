import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { ensureFixtures, anonClient, customerClient, type Fixtures } from "./fixtures";
import { verifyPaymongoSignature } from "../src/lib/payments/verify-signature";

/**
 * Online payments (migration 0019). confirm_order_payment/fail_order_payment
 * are cron-function-shaped - callable only by the service role, exactly like
 * expire_stale_offers (0008) and expire_stale_documents (0017) - since they
 * arrive from a webhook with no user session at all, not through PostgREST
 * with a customer's key. The signature check itself is a pure function and
 * is tested directly with no network or database involved.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc: SupabaseClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let fx: Fixtures;
beforeAll(async () => {
  fx = await ensureFixtures();
}, 30_000);

describe("verifyPaymongoSignature", () => {
  const secret = "whsec_test_123";
  const body = JSON.stringify({ data: { id: "evt_1" } });

  function sign(ts: string, payload: string) {
    return crypto.createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  }

  it("accepts a valid te= (test-mode) signature", () => {
    const ts = "1700000000";
    const header = `t=${ts},te=${sign(ts, body)}`;
    expect(verifyPaymongoSignature(body, header, secret)).toBe(true);
  });

  it("accepts a valid li= (live-mode) signature", () => {
    const ts = "1700000000";
    const header = `t=${ts},li=${sign(ts, body)}`;
    expect(verifyPaymongoSignature(body, header, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const ts = "1700000000";
    const header = `t=${ts},te=${sign(ts, body)}`;
    expect(verifyPaymongoSignature(body + "x", header, secret)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const ts = "1700000000";
    const header = `t=${ts},te=${sign(ts, body)}`;
    expect(verifyPaymongoSignature(body, header, "wrong_secret")).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyPaymongoSignature(body, null, secret)).toBe(false);
    expect(verifyPaymongoSignature(body, "garbage", secret)).toBe(false);
    expect(verifyPaymongoSignature(body, "t=1700000000", secret)).toBe(false);
  });
});

describe("confirm_order_payment / fail_order_payment access control", () => {
  it("is not reachable through a user session, only the service role", async () => {
    const customer = await customerClient();
    const confirm = await customer.rpc("confirm_order_payment", { p_order_id: crypto.randomUUID(), p_provider_payment_id: "x" });
    expect(confirm.error).not.toBeNull();

    const fail = await customer.rpc("fail_order_payment", { p_order_id: crypto.randomUUID(), p_reason: "x" });
    expect(fail.error).not.toBeNull();

    const anon = anonClient();
    const anonConfirm = await anon.rpc("confirm_order_payment", { p_order_id: crypto.randomUUID(), p_provider_payment_id: "x" });
    expect(anonConfirm.error).not.toBeNull();
  });
});

describe("online payment order lifecycle", () => {
  async function placeGcashOrder(): Promise<string> {
    const customer = await customerClient();
    const { data: cartId, error: cartErr } = await customer.rpc("add_to_cart", {
      p_menu_item_id: fx.itemId,
      p_quantity: 1,
      p_option_ids: [],
      p_notes: null,
      p_replace_cart: true,
    });
    if (cartErr) throw cartErr;

    const { error: priceErr } = await customer.rpc("price_cart", {
      p_cart_id: cartId,
      p_address_id: fx.addressId,
      p_promo_code: null,
    });
    if (priceErr) throw priceErr;

    const { data: orderId, error: placeErr } = await customer.rpc("place_order", {
      p_cart_id: cartId,
      p_address_id: fx.addressId,
      p_payment_method: "gcash",
      p_promo_code: null,
      p_tip_centavos: 0,
    });
    if (placeErr) throw placeErr;
    return orderId as string;
  }

  const orderIds: string[] = [];
  afterAll(async () => {
    if (orderIds.length > 0) await svc.from("orders").delete().in("id", orderIds);
  });

  it("a gcash order starts pending_payment, not placed", async () => {
    const orderId = await placeGcashOrder();
    orderIds.push(orderId);

    const { data } = await svc.from("orders").select("status, payment_status, payment_method").eq("id", orderId).single();
    expect(data!.status).toBe("pending_payment");
    expect(data!.payment_status).toBe("pending");
    expect(data!.payment_method).toBe("gcash");
  });

  it("confirm_order_payment moves it to placed/paid, and is idempotent", async () => {
    const orderId = await placeGcashOrder();
    orderIds.push(orderId);

    const { error } = await svc.rpc("confirm_order_payment", { p_order_id: orderId, p_provider_payment_id: "evt_first" });
    expect(error).toBeNull();

    const { data: after } = await svc.from("orders").select("status, payment_status, provider_payment_id, placed_at").eq("id", orderId).single();
    expect(after!.status).toBe("placed");
    expect(after!.payment_status).toBe("paid");
    expect(after!.provider_payment_id).toBe("evt_first");
    expect(after!.placed_at).not.toBeNull();

    // A retried webhook delivery (a second "paid" event, or the same one
    // redelivered) must not re-run anything - provider_payment_id does not
    // change to whatever this second call passes.
    const { error: secondError } = await svc.rpc("confirm_order_payment", { p_order_id: orderId, p_provider_payment_id: "evt_second" });
    expect(secondError).toBeNull();

    const { data: unchanged } = await svc.from("orders").select("provider_payment_id").eq("id", orderId).single();
    expect(unchanged!.provider_payment_id).toBe("evt_first");
  });

  it("fail_order_payment cancels it", async () => {
    const orderId = await placeGcashOrder();
    orderIds.push(orderId);

    const { error } = await svc.rpc("fail_order_payment", { p_order_id: orderId, p_reason: "Card declined." });
    expect(error).toBeNull();

    const { data } = await svc.from("orders").select("status, payment_status, cancellation_reason").eq("id", orderId).single();
    expect(data!.status).toBe("cancelled");
    expect(data!.payment_status).toBe("failed");
    expect(data!.cancellation_reason).toMatch(/declined/i);
  });

  it("a late confirm_order_payment after cancellation records the payment but does not resurrect the order", async () => {
    const orderId = await placeGcashOrder();
    orderIds.push(orderId);

    await svc.rpc("fail_order_payment", { p_order_id: orderId, p_reason: "Timed out." });

    const { error } = await svc.rpc("confirm_order_payment", { p_order_id: orderId, p_provider_payment_id: "evt_late" });
    expect(error).toBeNull();

    const { data } = await svc.from("orders").select("status, payment_status, provider_payment_id").eq("id", orderId).single();
    expect(data!.status).toBe("cancelled");
    expect(data!.payment_status).toBe("paid");
    expect(data!.provider_payment_id).toBe("evt_late");
  });
});
