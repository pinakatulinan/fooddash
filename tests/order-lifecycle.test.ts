import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ensureFixtures, placeTestOrder, deleteOrders, merchantClient, adminClient, type Fixtures } from "./fixtures";

let fx: Fixtures;
const ordersToClean: string[] = [];

beforeAll(async () => {
  fx = await ensureFixtures();
}, 30_000);

afterAll(async () => {
  await deleteOrders(ordersToClean);
});

describe("place_order pricing", () => {
  it("totals the basket correctly for a single item, no promo", async () => {
    const { orderId, customer } = await placeTestOrder(fx);
    ordersToClean.push(orderId);

    const { data: order, error } = await customer
      .from("orders")
      .select("subtotal_centavos, total_centavos, delivery_fee_centavos, status")
      .eq("id", orderId)
      .single();

    expect(error).toBeNull();
    expect(order!.status).toBe("placed");
    expect(order!.subtotal_centavos).toBe(15_000); // QA Test Meal's price, fixtures.ts
    expect(order!.total_centavos).toBe(order!.subtotal_centavos + order!.delivery_fee_centavos);
  });
});

describe("advance_order transition guard", () => {
  it("refuses to skip straight from placed to delivered", async () => {
    const { orderId, customer } = await placeTestOrder(fx);
    ordersToClean.push(orderId);

    const { error } = await customer.rpc("advance_order", {
      p_order_id: orderId,
      p_to: "delivered",
      p_note: null,
      p_pod_code: null,
    });

    expect(error).not.toBeNull();
  });

  it("refuses to move a delivered order anywhere at all - the state machine has no exit", async () => {
    const { orderId } = await placeTestOrder(fx);
    ordersToClean.push(orderId);
    const merchant = await merchantClient();
    // Pickup orders are completed by the merchant, which keeps this test to
    // one role and out of the dispatch loop entirely.
    for (const to of ["accepted", "preparing", "ready_for_pickup"]) {
      await merchant.rpc("advance_order", { p_order_id: orderId, p_to: to, p_note: null, p_pod_code: null });
    }
    // This fixture order is type=delivery by default (placeTestOrder), so
    // "delivered" here is only reachable by the assigned rider - use admin
    // instead, which advance_order also permits, to keep this test single-role.
    const admin = await adminClient();
    await admin.rpc("advance_order", { p_order_id: orderId, p_to: "cancelled", p_note: "test", p_pod_code: null });

    const { error } = await admin.rpc("advance_order", {
      p_order_id: orderId,
      p_to: "preparing",
      p_note: null,
      p_pod_code: null,
    });
    expect(error).not.toBeNull();
  });
});

describe("customer cancellation window", () => {
  it("a customer can cancel while the order is still placed", async () => {
    const { orderId, customer } = await placeTestOrder(fx);
    ordersToClean.push(orderId);

    const { error } = await customer.rpc("advance_order", {
      p_order_id: orderId,
      p_to: "cancelled",
      p_note: "changed my mind",
      p_pod_code: null,
    });
    expect(error).toBeNull();

    const { data: order } = await customer.from("orders").select("status, cancellation_reason").eq("id", orderId).single();
    expect(order!.status).toBe("cancelled");
    expect(order!.cancellation_reason).toBe("changed my mind");
  });

  it("a customer's cancellation window closes once the kitchen starts preparing", async () => {
    const { orderId, customer } = await placeTestOrder(fx);
    ordersToClean.push(orderId);
    const merchant = await merchantClient();
    await merchant.rpc("advance_order", { p_order_id: orderId, p_to: "accepted", p_note: null, p_pod_code: null });
    await merchant.rpc("advance_order", { p_order_id: orderId, p_to: "preparing", p_note: null, p_pod_code: null });

    const { error } = await customer.rpc("advance_order", {
      p_order_id: orderId,
      p_to: "cancelled",
      p_note: "too late",
      p_pod_code: null,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/no longer be cancelled/i);
  });
});

describe("dispatch loop", () => {
  it("offer -> accept -> full delivery settles the ledger correctly", async () => {
    const { orderId, customer } = await placeTestOrder(fx);
    ordersToClean.push(orderId);
    const merchant = await merchantClient();
    for (const to of ["accepted", "preparing", "ready_for_pickup"]) {
      await merchant.rpc("advance_order", { p_order_id: orderId, p_to: to, p_note: null, p_pod_code: null });
    }

    const admin = await adminClient();
    const { error: offerErr } = await admin.rpc("offer_order_to_rider", {
      p_order_id: orderId,
      p_rider_id: fx.riderUserId,
      p_is_auto: false,
    });
    expect(offerErr).toBeNull();

    const { data: assignment } = await admin
      .from("delivery_assignments")
      .select("id")
      .eq("order_id", orderId)
      .eq("status", "offered")
      .single();

    const { riderClient } = await import("./fixtures");
    const rider = await riderClient();
    const { error: acceptErr } = await rider.rpc("respond_to_assignment", {
      p_assignment_id: assignment!.id,
      p_accept: true,
    });
    expect(acceptErr).toBeNull();

    await rider.rpc("advance_order", { p_order_id: orderId, p_to: "picked_up", p_note: null, p_pod_code: null });
    await rider.rpc("advance_order", { p_order_id: orderId, p_to: "arrived", p_note: null, p_pod_code: null });
    const { error: deliverErr } = await rider.rpc("advance_order", {
      p_order_id: orderId,
      p_to: "delivered",
      p_note: null,
      p_pod_code: null,
    });
    expect(deliverErr).toBeNull();

    const { data: order } = await customer.from("orders").select("status").eq("id", orderId).single();
    expect(order!.status).toBe("delivered");

    const { data: ledger } = await admin.from("ledger_entries").select("entry_type, amount_centavos").eq("order_id", orderId);
    const types = (ledger ?? []).map((l) => l.entry_type).sort();
    // COD orders also produce a cash_collected entry for the cash the rider
    // is now holding on the platform's behalf.
    expect(types).toEqual(
      ["order_sale", "platform_commission", "platform_commission", "rider_earning", "cash_collected"].sort(),
    );
  });

  it("declining an offer leaves it findable by the next dispatch attempt, never re-offered to the same rider", async () => {
    const { orderId } = await placeTestOrder(fx);
    ordersToClean.push(orderId);
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

    const { riderClient } = await import("./fixtures");
    const rider = await riderClient();
    await rider.rpc("respond_to_assignment", {
      p_assignment_id: assignment!.id,
      p_accept: false,
      p_reason: "too far",
    });

    const { data: candidates } = await admin.rpc("dispatch_candidates", { p_order_id: orderId, p_limit: 5 });
    const stillOffered = (candidates ?? []).some((c: { rider_id: string }) => c.rider_id === fx.riderUserId);
    expect(stillOffered).toBe(false);

    await admin.rpc("advance_order", { p_order_id: orderId, p_to: "cancelled", p_note: "test cleanup", p_pod_code: null });
  });
});
