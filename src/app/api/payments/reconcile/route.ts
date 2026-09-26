import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCheckoutSessionState } from "@/lib/payments/paymongo";
import { requireReconcileSecret } from "@/lib/env";
import { timingSafeEqualString } from "@/lib/security";

/**
 * Fallback for confirm_order_payment (0019) when the webhook never fires -
 * built after four real test payments succeeded on PayMongo's side but
 * produced zero webhook deliveries, for reasons only PayMongo's own logs can
 * explain. This asks PayMongo directly instead of waiting to be told: for
 * every order still sitting in pending_payment with a checkout session on
 * file, look the session up and confirm it if PayMongo already shows it
 * paid. Same RPC the webhook calls, just a different way of finding out.
 *
 * Not a public endpoint - a caller must know PAYMENT_RECONCILE_SECRET, the
 * same way a scheduler (once one exists) would authenticate a sweep. Until
 * then it is triggered manually / from a local interval during testing.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-reconcile-secret");
  let expected: string;
  try {
    expected = requireReconcileSecret();
  } catch (err) {
    console.error("[payments reconcile]", err);
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  if (!timingSafeEqualString(secret, expected)) {
    return NextResponse.json({ error: "not_authorised" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: orders, error } = await admin
    .from("orders")
    .select("id, code, provider_payment_id")
    .eq("status", "pending_payment")
    .eq("payment_status", "pending")
    .not("provider_payment_id", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { orderId: string; code: string; outcome: string }[] = [];

  for (const order of orders ?? []) {
    try {
      const state = await getCheckoutSessionState(order.provider_payment_id!);

      // Belt-and-suspenders: only act on a session whose own metadata still
      // points back at this order, in case a provider_payment_id was ever
      // reused or looked up under the wrong row.
      if (state.orderId && state.orderId !== order.id) {
        results.push({ orderId: order.id, code: order.code, outcome: "metadata_mismatch" });
        continue;
      }

      if (state.paidPaymentId) {
        const { error: confirmError } = await admin.rpc("confirm_order_payment", {
          p_order_id: order.id,
          p_provider_payment_id: state.paidPaymentId,
        });
        results.push({
          orderId: order.id,
          code: order.code,
          outcome: confirmError ? `confirm_failed: ${confirmError.message}` : "confirmed",
        });
      } else {
        results.push({ orderId: order.id, code: order.code, outcome: "still_unpaid" });
      }
    } catch (err) {
      results.push({
        orderId: order.id,
        code: order.code,
        outcome: `lookup_failed: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
  }

  return NextResponse.json({ checked: results.length, results });
}
