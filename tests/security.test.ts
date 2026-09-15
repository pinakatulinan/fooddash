import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ensureFixtures,
  placeTestOrder,
  deleteOrders,
  merchantClient,
  riderClient,
  adminClient,
  anonClient,
  type Fixtures,
} from "./fixtures";

/**
 * Every test here reproduces a real bug found (and fixed) by hand this
 * project, one at a time, over the course of a long session - the whole
 * reason this suite exists. Each one failed against the vulnerable code
 * before its fix; they exist so none of these regress silently again.
 */

let fx: Fixtures;
const ordersToClean: string[] = [];

beforeAll(async () => {
  fx = await ensureFixtures();
}, 30_000);

afterAll(async () => {
  await deleteOrders(ordersToClean);
});

describe("dispatch_candidates / offer_order_to_rider auth", () => {
  it("rejects a non-admin forging p_is_auto=true (the original privilege escalation)", async () => {
    const { orderId, customer } = await placeTestOrder(fx);
    ordersToClean.push(orderId);

    // customer is not a member of this merchant, not an admin, and not the
    // assigned rider - forging p_is_auto used to be enough to assign anyone
    // to anyone's order anyway.
    const { error } = await customer.rpc("offer_order_to_rider", {
      p_order_id: orderId,
      p_rider_id: fx.riderUserId,
      p_is_auto: true,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/only ops may assign riders/i);
  });

  it("dispatch_candidates refuses the same forged flag for a non-admin", async () => {
    const { orderId, customer } = await placeTestOrder(fx);
    ordersToClean.push(orderId);

    const { error } = await customer.rpc("dispatch_candidates", {
      p_order_id: orderId,
      p_limit: 5,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not_authorised/i);
  });

  it("a real admin can still assign a rider (the fix did not just lock everyone out)", async () => {
    const { orderId, customer } = await placeTestOrder(fx);
    ordersToClean.push(orderId);
    const merchant = await merchantClient();
    for (const to of ["accepted", "preparing", "ready_for_pickup"]) {
      const { error } = await merchant.rpc("advance_order", {
        p_order_id: orderId,
        p_to: to,
        p_note: null,
        p_pod_code: null,
      });
      expect(error).toBeNull();
    }

    const admin = await adminClient();
    const { error } = await admin.rpc("offer_order_to_rider", {
      p_order_id: orderId,
      p_rider_id: fx.riderUserId,
      p_is_auto: false,
    });
    expect(error).toBeNull();

    void customer; // keep the placeholder client referenced for readability
  });
});

describe("reviews - target spoofing", () => {
  it("cannot aim a review at a merchant unrelated to the order", async () => {
    const { orderId, customer } = await placeTestOrder(fx);
    ordersToClean.push(orderId);

    // Walk it to delivered so the review write policy's status check passes.
    const merchant = await merchantClient();
    for (const to of ["accepted", "preparing", "ready_for_pickup"]) {
      await merchant.rpc("advance_order", { p_order_id: orderId, p_to: to, p_note: null, p_pod_code: null });
    }
    const admin = await adminClient();
    await admin.rpc("offer_order_to_rider", { p_order_id: orderId, p_rider_id: fx.riderUserId, p_is_auto: false });
    const { data: assignment } = await admin
      .from("delivery_assignments")
      .select("id")
      .eq("order_id", orderId)
      .eq("status", "offered")
      .single();
    const rider = await riderClient();
    await rider.rpc("respond_to_assignment", { p_assignment_id: assignment!.id, p_accept: true });
    await rider.rpc("advance_order", { p_order_id: orderId, p_to: "picked_up", p_note: null, p_pod_code: null });
    await rider.rpc("advance_order", { p_order_id: orderId, p_to: "arrived", p_note: null, p_pod_code: null });
    await rider.rpc("advance_order", { p_order_id: orderId, p_to: "delivered", p_note: null, p_pod_code: null });

    // Some other real merchant in the seed data - not the one this order was
    // ever placed with.
    const SOME_OTHER_MERCHANT_ID = "bbbbbbbb-0000-4000-8000-000000000001";

    const { data: review, error } = await customer
      .from("reviews")
      .insert({
        order_id: orderId,
        customer_id: fx.customerId,
        merchant_id: SOME_OTHER_MERCHANT_ID,
        merchant_rating: 1,
        comment: "attempted spoof",
      })
      .select("merchant_id")
      .single();

    expect(error).toBeNull();
    // The trigger must have overwritten it to the order's real store.
    expect(review!.merchant_id).toBe(fx.merchantId);
    expect(review!.merchant_id).not.toBe(SOME_OTHER_MERCHANT_ID);
  });
});

describe("promos - funding manipulation", () => {
  it("a merchant cannot make the platform fund their own store's promo", async () => {
    const merchant = await merchantClient();
    const code = `QATEST${Date.now().toString().slice(-6)}`;

    const { data: promo, error } = await merchant
      .from("promos")
      .insert({
        merchant_id: fx.merchantId,
        code,
        type: "percent_off",
        value: 10,
        funded_by: "platform",
        merchant_share: 0,
      })
      .select("funded_by, merchant_share")
      .single();

    expect(error).toBeNull();
    expect(promo!.funded_by).toBe("merchant");
    expect(promo!.merchant_share).toBe(1);

    await merchant.from("promos").delete().eq("code", code);
  });
});

describe("support tickets - internal note privacy", () => {
  it("an internal staff note is invisible to the customer who raised the ticket", async () => {
    const { orderId, customer } = await placeTestOrder(fx);
    ordersToClean.push(orderId);

    const { data: ticket, error: ticketErr } = await customer
      .from("support_tickets")
      .insert({ order_id: orderId, raised_by: fx.customerId, category: "late", subject: "QA test ticket" })
      .select("id")
      .single();
    expect(ticketErr).toBeNull();

    const admin = await adminClient();
    const { data: adminUser } = await admin.auth.getUser();
    await admin.from("support_messages").insert({
      ticket_id: ticket!.id,
      author_id: adminUser.user!.id,
      body: "internal only - should never reach the customer",
      is_internal: true,
    });

    const { data: visibleToCustomer } = await customer
      .from("support_messages")
      .select("id")
      .eq("ticket_id", ticket!.id);

    expect(visibleToCustomer ?? []).toHaveLength(0);
  });
});

describe("admin-only tables stay admin-only", () => {
  it("a non-admin cannot write platform_settings, even through the raw table", async () => {
    const merchant = await merchantClient();
    const { error } = await merchant.from("platform_settings").update({ value: "hacked" }).eq("key", "dispatch_mode");
    expect(error).not.toBeNull();
  });

  it("update_platform_setting refuses a non-admin caller", async () => {
    const merchant = await merchantClient();
    const { error } = await merchant.rpc("update_platform_setting", {
      p_key: "dispatch_mode",
      p_value: "auto",
      p_note: "should be refused",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not_authorised/i);
  });

  it("an anonymous, signed-out caller cannot read dispatch_candidates output at all", async () => {
    const { orderId } = await placeTestOrder(fx);
    ordersToClean.push(orderId);

    const anon = anonClient();
    const { error } = await anon.rpc("dispatch_candidates", { p_order_id: orderId, p_limit: 5 });
    expect(error).not.toBeNull();
  });
});
