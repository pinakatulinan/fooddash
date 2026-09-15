"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { OrderStatus } from "@/lib/types/domain";

// Mirrors advance_order's own rule (migration 0008): a customer's window to
// cancel closes the moment the kitchen commits to the order. Past 'placed'
// the button simply stops rendering - the database would refuse it anyway,
// but there's no reason to show a control that only ever errors.
const CUSTOMER_CANCELLABLE: OrderStatus[] = ["draft", "pending_payment", "placed"];

export function CancelOrder({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!CUSTOMER_CANCELLABLE.includes(status)) return null;

  async function handleCancel() {
    const reason = window.prompt("Why are you cancelling? (optional, shown to the store)");
    if (reason === null) return; // dismissed

    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("advance_order", {
      p_order_id: orderId,
      p_to: "cancelled",
      p_note: reason || null,
      p_pod_code: null,
    });

    setPending(false);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }

    router.refresh();
  }

  return (
    <div>
      <Button variant="danger" fullWidth loading={pending} onClick={handleCancel}>
        Cancel order
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-center text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
