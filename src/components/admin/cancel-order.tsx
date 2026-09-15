"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Ops override: cancel any order that hasn't reached a rider's hands yet.
 *
 * advance_order() grants this to admins regardless of which merchant the
 * order belongs to (is_admin() bypasses the "must be this store's member"
 * check a merchant-initiated cancel would otherwise need), so this needs no
 * merchant-membership plumbing - just the same terminal-safe status gate the
 * page already uses to decide when dispatch makes sense.
 */
export function CancelOrderAdmin({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleCancel() {
    const reason = window.prompt("Why is ops cancelling this order? (shown to the customer)");
    if (reason === null) return;

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
    <div className="text-right">
      <Button size="sm" variant="ghost" className="text-danger" loading={pending} onClick={handleCancel}>
        Cancel
      </Button>
      {error && <p className="mt-1 text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}
