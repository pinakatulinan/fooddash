"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Accept or decline one delivery offer.
 *
 * Both call `respond_to_assignment`, which is where the real rules live: an
 * expired offer is rejected server-side even if this button hasn't noticed
 * the countdown hit zero yet, and accepting sets the rider en_route_to_store
 * itself. This component only has to react to what comes back.
 */
export function OfferActions({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<"accept" | "decline" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function respond(accept: boolean) {
    let reason: string | null = null;
    if (!accept) {
      reason = window.prompt("Why are you declining this offer? (optional)");
      if (reason === null) return; // dismissed the prompt
    }

    setPending(accept ? "accept" : "decline");
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("respond_to_assignment", {
      p_assignment_id: assignmentId,
      p_accept: accept,
      p_reason: reason || null,
    });

    setPending(null);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }

    // An accepted offer is now the rider's active delivery - go straight
    // there instead of leaving them on a list the offer just vanished from.
    if (accept) router.push("/rider/active");
    else router.refresh();
  }

  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          loading={pending === "accept"}
          disabled={pending !== null && pending !== "accept"}
          onClick={() => respond(true)}
        >
          Accept
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="flex-1"
          loading={pending === "decline"}
          disabled={pending !== null && pending !== "decline"}
          onClick={() => respond(false)}
        >
          Decline
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
