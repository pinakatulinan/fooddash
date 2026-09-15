"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatManilaTime } from "@/lib/format";

const QUICK_DURATIONS = [
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
];

/**
 * Pause or resume the store's own ability to take orders.
 *
 * A quick pause (paused_until set, is_accepting_orders left on) reopens the
 * store on its own once real time passes that mark - is_merchant_open() (0003)
 * already treats it that way. An indefinite pause (is_accepting_orders off)
 * has no expiry; someone has to come back and resume it. Both write through
 * pause_store()/resume_store() rather than a direct table update, because the
 * duration has to be resolved against the database's own clock (now() +
 * interval), not this browser's - see the RPC's own comment (0011) for why
 * that distinction actually matters here.
 */
export function PauseStoreControl({
  merchantId,
  isAcceptingOrders,
  pausedUntil,
  pauseReason,
}: {
  merchantId: string;
  isAcceptingOrders: boolean;
  pausedUntil: string | null;
  pauseReason: string | null;
}) {
  const router = useRouter();
  const [showOptions, setShowOptions] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isPaused = !isAcceptingOrders || pausedUntil !== null;

  async function pause(minutes: number | null) {
    let reason: string | null = null;
    if (minutes === null) {
      reason = window.prompt("Why are you pausing? (optional, shown to ops)");
      if (reason === null) return; // dismissed
    }

    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("pause_store", {
      p_merchant_id: merchantId,
      p_minutes: minutes,
      p_reason: reason || null,
    });
    setPending(false);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    setShowOptions(false);
    router.refresh();
  }

  async function resume() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("resume_store", { p_merchant_id: merchantId });
    setPending(false);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    router.refresh();
  }

  if (isPaused) {
    return (
      <div className="space-y-2 rounded-md border border-line bg-surface p-4">
        <p className="text-sm">
          <span className="font-semibold">This store is not taking orders right now.</span>
          {pausedUntil && <> Reopens automatically around {formatManilaTime(pausedUntil)}.</>}
          {pauseReason && <span className="block text-fg-muted">Reason: {pauseReason}</span>}
        </p>
        <Button size="sm" loading={pending} onClick={resume}>
          Resume now
        </Button>
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (!showOptions) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setShowOptions(true)}>
        Pause store
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-line bg-surface p-4">
      <p className="text-sm font-semibold">How long?</p>
      <div className="flex flex-wrap gap-2">
        {QUICK_DURATIONS.map((d) => (
          <Button key={d.minutes} size="sm" variant="secondary" loading={pending} onClick={() => pause(d.minutes)}>
            {d.label}
          </Button>
        ))}
        <Button size="sm" variant="danger" loading={pending} onClick={() => pause(null)}>
          Until I resume it
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowOptions(false)}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
