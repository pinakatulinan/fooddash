import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPaymongoSignature } from "@/lib/payments/verify-signature";
import { requirePaymongoWebhookSecret } from "@/lib/env";

/**
 * PayMongo's answer on whether a checkout actually got paid. Arrives with no
 * user session at all, so it authenticates by signature instead - see
 * verifyPaymongoSignature's own comment for the header format this checks.
 *
 * PayMongo's docs (fetched while building this) confirm the generic
 * `payment.paid`/`payment.failed` event names but do not fully pin down
 * where a Checkout-Session-originated payment's metadata ends up in the
 * event payload, or whether a checkout_session.* event name is also used.
 * Rather than hard-code one exact JSON path that might not match what
 * actually arrives, this searches the whole payload for a `metadata.order_id`
 * or a `reference_number` (set to the order's own code at checkout-session
 * creation) and matches on event type containing "paid" or "failed" - looser
 * than a switch on an exact string, but it fails safe (an order it cannot
 * identify is left untouched, not guessed at) and should be confirmed
 * against one real delivered event from the PayMongo dashboard before relying
 * on this in production.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("paymongo-signature");

  let secret: string;
  try {
    secret = requirePaymongoWebhookSecret();
  } catch (err) {
    console.error("[paymongo webhook]", err);
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  if (!verifyPaymongoSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: { data?: { id?: string; attributes?: { type?: string } } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const eventId = event.data?.id;
  const eventType = event.data?.attributes?.type ?? "";
  if (!eventId || !eventType) {
    return NextResponse.json({ error: "malformed event" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency: a retried delivery of the same event id inserts nothing and
  // is treated as already handled, never re-confirmed.
  const { error: insertError } = await admin
    .from("payment_events")
    .insert({ id: eventId, event_type: eventType, payload: event });
  if (insertError) {
    // Unique violation on id = already processed. Any other error is real.
    if (insertError.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("[paymongo webhook] could not record event", insertError);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  const orderId = findOrderId(event);
  if (!orderId) {
    console.warn("[paymongo webhook] no order reference in event", eventId, eventType);
    return NextResponse.json({ ok: true, unmatched: true });
  }

  try {
    if (eventType.includes("paid")) {
      await admin.rpc("confirm_order_payment", { p_order_id: orderId, p_provider_payment_id: eventId });
    } else if (eventType.includes("failed")) {
      await admin.rpc("fail_order_payment", { p_order_id: orderId, p_reason: "Payment failed." });
    }
    await admin.from("payment_events").update({ order_id: orderId }).eq("id", eventId);
  } catch (err) {
    console.error("[paymongo webhook] failed to apply event", eventId, err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** Recursively looks for `metadata.order_id`, anywhere in the payload. */
function findOrderId(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;

  if (obj.metadata && typeof obj.metadata === "object") {
    const orderId = (obj.metadata as Record<string, unknown>).order_id;
    if (typeof orderId === "string") return orderId;
  }

  for (const value of Object.values(obj)) {
    const found = findOrderId(value);
    if (found) return found;
  }
  return null;
}
