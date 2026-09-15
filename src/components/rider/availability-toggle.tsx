"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/status-pill";
import type { RiderStatus } from "@/lib/types/domain";

/**
 * Go online / go offline.
 *
 * Calls the `set_rider_availability` RPC rather than updating riders.status
 * directly: going online also opens a shift row, and the database refuses to
 * let a rider go offline mid-delivery. Both rules live in one place, in SQL,
 * where the rider app, the ops console and any future native client all get
 * them for free.
 */
export function AvailabilityToggle({
  initialStatus,
  isVerified,
}: {
  initialStatus: RiderStatus;
  isVerified: boolean;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const online = status !== "offline";

  async function toggle() {
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("set_rider_availability", {
      p_online: !online,
    });

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }

    setStatus((data as { status: RiderStatus } | null)?.status ?? (online ? "offline" : "online_idle"));
    startTransition(() => router.refresh());
  }

  if (!isVerified) {
    return (
      <div className="rounded-md border border-line bg-warning-tint px-4 py-3">
        <p className="text-sm font-bold text-warning">Verification pending</p>
        <p className="mt-0.5 text-sm text-fg-muted">
          Ops is reviewing your licence and clearance. You will be able to go online as soon as
          that clears.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button
          variant={online ? "secondary" : "primary"}
          size="lg"
          onClick={toggle}
          loading={pending}
          className="flex-1"
        >
          <Power aria-hidden className="size-4" />
          {online ? "Go offline" : "Go online"}
        </Button>
        <Pill tone={online ? "success" : "neutral"}>{online ? "Online" : "Offline"}</Pill>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
