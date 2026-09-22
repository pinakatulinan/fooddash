import "server-only";
import { requirePaymongoSecretKey } from "@/lib/env";
import type { PaymentMethod } from "@/lib/types/domain";

export { verifyPaymongoSignature } from "./verify-signature";

const API_BASE = "https://api.paymongo.com/v1";

/** PayMongo's field name for Maya's e-wallet predates the GCash/PayMaya-to-Maya rebrand. */
export function toPaymongoMethod(method: Exclude<PaymentMethod, "cod">): "gcash" | "paymaya" | "card" {
  return method === "maya" ? "paymaya" : method;
}

export interface CheckoutSession {
  id: string;
  checkoutUrl: string;
}

/**
 * One line item for the whole order total, rather than itemising the cart -
 * PayMongo charges exactly the sum of line_items, and the order's own
 * subtotal/fees/discount/tip breakdown is already reconciled and displayed
 * by order_tracking(); duplicating it here would just be a second place for
 * the two to drift apart.
 */
export async function createCheckoutSession(args: {
  orderId: string;
  orderCode: string;
  merchantName: string;
  amountCentavos: number;
  method: Exclude<PaymentMethod, "cod">;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutSession> {
  const secretKey = requirePaymongoSecretKey();
  const auth = Buffer.from(`${secretKey}:`).toString("base64");

  const res = await fetch(`${API_BASE}/checkout_sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [
            {
              amount: args.amountCentavos,
              currency: "PHP",
              name: `Order ${args.orderCode}`,
              description: args.merchantName,
              quantity: 1,
            },
          ],
          payment_method_types: [toPaymongoMethod(args.method)],
          reference_number: args.orderCode,
          success_url: args.successUrl,
          cancel_url: args.cancelUrl,
          send_email_receipt: false,
          show_line_items: true,
          // Values only, string-typed - the webhook reads this back to know
          // which order to confirm.
          metadata: { order_id: args.orderId },
        },
      },
    }),
  });

  const json: {
    data?: { id: string; attributes: { checkout_url: string } };
    errors?: { detail?: string }[];
  } = await res.json();

  if (!res.ok || !json.data) {
    throw new Error(json.errors?.[0]?.detail ?? "PayMongo could not start the checkout.");
  }

  return { id: json.data.id, checkoutUrl: json.data.attributes.checkout_url };
}

export interface CheckoutSessionState {
  orderId: string | null;
  /** The first payment PayMongo has recorded as paid against this session, if any. */
  paidPaymentId: string | null;
}

/**
 * Reconciliation's only real question: has this session actually been paid?
 * The session's own top-level `status` stays "active" even after a
 * successful payment - confirmed by fetching a real paid session while
 * debugging why its webhook never arrived - so the answer lives in
 * `payments[]` instead, same as the webhook payload would have carried.
 */
export async function getCheckoutSessionState(checkoutSessionId: string): Promise<CheckoutSessionState> {
  const secretKey = requirePaymongoSecretKey();
  const auth = Buffer.from(`${secretKey}:`).toString("base64");

  const res = await fetch(`${API_BASE}/checkout_sessions/${checkoutSessionId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  const json: {
    data?: {
      attributes?: {
        metadata?: { order_id?: string };
        payments?: { id: string; attributes?: { status?: string } }[];
      };
    };
    errors?: { detail?: string }[];
  } = await res.json();

  if (!res.ok || !json.data) {
    throw new Error(json.errors?.[0]?.detail ?? "PayMongo could not look up that checkout session.");
  }

  const attrs = json.data.attributes ?? {};
  const paid = (attrs.payments ?? []).find((p) => p.attributes?.status === "paid");

  return { orderId: attrs.metadata?.order_id ?? null, paidPaymentId: paid?.id ?? null };
}
