"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, cn } from "@/lib/utils";
import type { RiderStatus } from "@/lib/types/domain";

/**
 * Go online / go offline.
 *
 * Calls the `set_rider_availability` RPC rather than updating riders.status
 * directly: going online also opens a shift row, and the database refuses to
 * let a rider go offline mid-delivery. Both rules live in one place, in SQL,
 * where the rider app, the ops console and any future native client all get
 * them for free.
 *
 * Only ever rendered on the teal header band of the Jobs page, so this is
 * styled for a dark background rather than taking a variant prop for one.
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
      <div className="rounded-[20px] bg-white/10 px-4 py-3">
        <p className="text-sm font-bold text-white">Verification pending</p>
        <p className="mt-0.5 text-xs text-white/75">
          You can go online once ops have approved all your documents.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-[20px] bg-white/10 py-1.5 pr-1.5 pl-4">
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={cn(
              "size-2.5 rounded-pill ring-4",
              online ? "bg-[#5CC9AB] ring-[#5cc9ab40]" : "bg-white/40 ring-white/10",
            )}
          />
          <span className="text-[15px] font-bold text-white">{online ? "You're online" : "You're offline"}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={online}
          aria-label={online ? "Go offline" : "Go online"}
          onClick={toggle}
          disabled={pending}
          className={cn(
            "relative h-8.5 w-14.5 shrink-0 rounded-pill transition-colors disabled:opacity-60",
            online ? "bg-[#5CC9AB]" : "bg-white/20",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "absolute top-0.5 size-7.5 rounded-pill bg-white shadow-card transition-transform",
              online ? "translate-x-6" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white">
          {error}
        </p>
      )}
    </div>
  );
}
