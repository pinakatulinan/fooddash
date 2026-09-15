"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { OrderStatus } from "@/lib/types/domain";

/**
 * The rider's own progress through an accepted delivery.
 *
 * Only two statuses put an action in the rider's hands: ready_for_pickup
 * ("Picked up") and picked_up ("Arrived"). Everything before that is the
 * kitchen's problem, not the rider's - advance_order would refuse the move
 * anyway, so those states just show what the rider is waiting on.
 *
 * "Arrived" used to require a handover code before completing - dropped per
 * product decision (the code felt odd to hand a stranger at the door).
 * advance_order no longer sends one anywhere; place_order stopped
 * generating them, so there is nothing left to check either.
 */
export function DeliveryActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reportingProblem, setReportingProblem] = React.useState(false);

  async function advance(to: OrderStatus, note?: string) {
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("advance_order", {
      p_order_id: orderId,
      p_to: to,
      p_note: note ?? null,
      p_pod_code: null,
    });

    setPending(false);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }

    router.refresh();
  }

  async function reportFailed() {
    const reason = window.prompt("What went wrong? This is shown to the customer and to ops.");
    if (!reason) return; // dismissed, or nothing typed - do not report a blank failure
    await advance("failed", reason);
  }

  if (status === "accepted" || status === "preparing") {
    return (
      <div className="rounded-md border border-line bg-surface px-4 py-3 text-center text-sm text-fg-muted">
        Waiting on the kitchen — nothing to do here yet.
      </div>
    );
  }

  if (status === "ready_for_pickup") {
    return (
      <div className="space-y-2">
        <Button size="lg" fullWidth loading={pending} onClick={() => advance("picked_up")}>
          I&apos;ve picked up the order
        </Button>
        {error && (
          <p role="alert" className="text-center text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (status === "picked_up") {
    return (
      <div className="space-y-2">
        <Button size="lg" fullWidth loading={pending} onClick={() => advance("arrived")}>
          I&apos;ve arrived at the customer
        </Button>
        <ProblemLink reporting={reportingProblem} onOpen={() => setReportingProblem(true)} onConfirm={reportFailed} pending={pending} />
        {error && (
          <p role="alert" className="text-center text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (status === "arrived") {
    return (
      <div className="space-y-2">
        <Button size="lg" fullWidth loading={pending} onClick={() => advance("delivered")}>
          Complete delivery
        </Button>
        <ProblemLink reporting={reportingProblem} onOpen={() => setReportingProblem(true)} onConfirm={reportFailed} pending={pending} />
        {error && (
          <p role="alert" className="text-center text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return null;
}

function ProblemLink({
  reporting,
  onOpen,
  onConfirm,
  pending,
}: {
  reporting: boolean;
  onOpen: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  if (!reporting) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-center text-sm font-medium text-danger underline underline-offset-2"
      >
        Can&apos;t complete this delivery?
      </button>
    );
  }
  return (
    <Button size="sm" variant="danger" fullWidth loading={pending} onClick={onConfirm}>
      Report a problem — mark as failed
    </Button>
  );
}
