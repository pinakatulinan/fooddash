"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * Re-issues a PayMongo checkout session for an order stuck in
 * pending_payment - the same call checkout-form.tsx makes right after
 * place_order, just re-triggerable for a customer who closed the payment
 * tab, backed out, or came back after their session expired.
 */
export function RetryPaymentButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/payments/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const payload = await res.json().catch(() => null);

    if (!res.ok || !payload?.checkoutUrl) {
      setBusy(false);
      setError(payload?.error ?? "Could not start the payment.");
      return;
    }

    window.location.href = payload.checkoutUrl;
  }

  return (
    <div>
      <Button fullWidth loading={busy} onClick={retry}>
        Complete payment
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-center text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
