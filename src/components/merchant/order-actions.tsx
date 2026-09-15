"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { merchantActionsFor } from "@/lib/domain/order-status";
import type { OrderStatus, OrderType } from "@/lib/types/domain";

/**
 * Accept, decline, progress or cancel one order.
 *
 * Every button here calls `advance_order` - the single sanctioned path for
 * moving an order, already enforcing that only a member of this store may
 * accept/prepare/ready it. Nothing is re-validated client-side beyond
 * choosing which buttons to show: a merchant clicking "Accept" on an order
 * that a colleague just declined in another tab gets the database's real
 * answer back as an error, not a stale local assumption.
 */
export function OrderActions({
  orderId,
  status,
  type,
  /** Tight inline row for a table cell, instead of a bordered block for a card. */
  compact = false,
}: {
  orderId: string;
  status: OrderStatus;
  type: OrderType;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<OrderStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const actions = merchantActionsFor(status, type);
  if (actions.length === 0) return null;

  async function handleClick(to: OrderStatus, reasonPrompt?: string) {
    // window.prompt() returns null only when the user dismisses/cancels the
    // dialog - an empty string means they clicked OK with nothing typed,
    // which is a valid "no reason given" and should still proceed.
    let note: string | null = null;
    if (reasonPrompt) {
      note = window.prompt(reasonPrompt);
      if (note === null) return;
    }

    setPending(to);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("advance_order", {
      p_order_id: orderId,
      p_to: to,
      p_note: note || null,
      p_pod_code: null,
    });

    setPending(null);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }

    router.refresh();
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        compact ? "justify-end" : "mt-3 border-t border-line pt-3",
      )}
    >
      {actions.map((action) => (
        <Button
          key={action.to}
          size="sm"
          variant={action.variant}
          loading={pending === action.to}
          disabled={pending !== null && pending !== action.to}
          onClick={() => handleClick(action.to, action.reasonPrompt)}
        >
          {action.label}
        </Button>
      ))}
      {error && (
        <p role="alert" className="w-full text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
