import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCheckoutSession } from "@/lib/payments/paymongo";
import { siteUrl } from "@/lib/env";
import { isSameOrigin } from "@/lib/security";
import type { PaymentMethod } from "@/lib/types/domain";

/**
 * Starts (or restarts) an online payment for an order already placed with a
 * non-COD payment_method - place_order (0008) leaves it in 'pending_payment'
 * with nothing further to happen until this runs. Re-callable: a customer
 * whose PayMongo tab expired or who backed out can retry from the tracking
 * page, and each call simply issues a fresh checkout session over the same
 * order - nothing here changes payment_status, only confirm_order_payment
 * and fail_order_payment (via the webhook) do that.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "not_authorised" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const orderId = body?.orderId;
  if (typeof orderId !== "string") {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  // RLS already limits this to the signed-in customer's own order (or a
  // merchant/rider/admin party to it) - re-checking customer_id here is
  // belt-and-suspenders against ever charging the wrong person's card.
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, code, customer_id, merchant_id, status, payment_method, payment_status, total_centavos, merchants(name)")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.customer_id !== user.id) {
    return NextResponse.json({ error: "not_authorised" }, { status: 403 });
  }
  if (order.payment_method === "cod") {
    return NextResponse.json({ error: "This order is paying cash on delivery." }, { status: 400 });
  }
  if (order.status !== "pending_payment" || order.payment_status !== "pending") {
    return NextResponse.json({ error: "This order is not waiting on payment." }, { status: 400 });
  }

  const merchant = order.merchants as unknown as { name: string } | null;

  try {
    const session = await createCheckoutSession({
      orderId: order.id,
      orderCode: order.code,
      merchantName: merchant?.name ?? "FoodDash",
      amountCentavos: order.total_centavos,
      method: order.payment_method as Exclude<PaymentMethod, "cod">,
      successUrl: `${siteUrl}/orders/${order.id}?payment=success`,
      cancelUrl: `${siteUrl}/orders/${order.id}?payment=cancelled`,
    });

    // Service role: orders has no UPDATE policy for any session at all
    // (0009) - every write goes through a SECURITY DEFINER function. A
    // checkout session id is issued by this server, never client-supplied.
    const admin = createAdminClient();
    await admin
      .from("orders")
      .update({ provider_payment_id: session.id, payment_checkout_url: session.checkoutUrl })
      .eq("id", order.id);

    return NextResponse.json({ checkoutUrl: session.checkoutUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start the payment.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
