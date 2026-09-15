"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/status-pill";

interface RiderOption {
  id: string;
  fullName: string;
  vehicle: string;
  status: string;
  cashOnHandCentavos: number;
}

/**
 * Manual dispatch: assign one rider to one order.
 *
 * This lists every verified, non-suspended rider directly rather than
 * filtering through `dispatch_candidates` - that function's 2-minute ping
 * freshness and radius cutoffs are tuned for an automated offer loop picking
 * blind, not for a human dispatcher who can see the whole roster and use
 * judgement (a rider whose app went quiet 3 minutes ago is not necessarily
 * unreachable). Cash-on-hand is shown, not silently filtered on, for the
 * same reason.
 *
 * `acceptedRiderName` is the only assignment state this component trusts
 * from the page's own read: an 'accepted' assignment genuinely binds until
 * the order is delivered or cancelled. An 'offered' one does not get the same
 * treatment - whether it is still live depends on comparing its expiry to
 * *now*, and there is no server-clock-independent "now" available here to
 * compare it against safely. The button is simply always offered instead;
 * offer_order_to_rider() re-checks against the database's own clock and
 * self-heals a stale offer before deciding, so attempting a re-assign is
 * always the right move regardless of what any offer here claims.
 */
export function AssignRider({
  orderId,
  acceptedRiderName,
}: {
  orderId: string;
  acceptedRiderName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [riders, setRiders] = React.useState<RiderOption[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function openPicker() {
    setOpen(true);
    setError(null);
    if (riders) return;

    setLoading(true);
    const supabase = createClient();
    // riders has two FKs to profiles (id, and verified_by) - PostgREST refuses
    // an ambiguous embed, so the relationship has to be named explicitly.
    const { data, error: fetchError } = await supabase
      .from("riders")
      .select("id, vehicle, status, cash_on_hand_centavos, profiles!riders_id_fkey(full_name)")
      .eq("is_verified", true)
      .eq("is_suspended", false)
      .order("status");

    setLoading(false);

    if (fetchError) {
      setError(friendlyError(fetchError));
      return;
    }

    interface RiderRow {
      id: string;
      vehicle: string;
      status: string;
      cash_on_hand_centavos: number;
      profiles: { full_name: string | null } | null;
    }

    const options = ((data ?? []) as unknown as RiderRow[]).map((r) => ({
      id: r.id,
      fullName: r.profiles?.full_name ?? "Unnamed rider",
      vehicle: r.vehicle,
      status: r.status,
      cashOnHandCentavos: r.cash_on_hand_centavos,
    }));
    setRiders(options);
    if (options.length > 0) setSelected(options[0].id);
  }

  async function sendOffer() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("offer_order_to_rider", {
      p_order_id: orderId,
      p_rider_id: selected,
      p_is_auto: false,
    });

    setSubmitting(false);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }

    setOpen(false);
    router.refresh();
  }

  if (acceptedRiderName) {
    return (
      <div className="text-right">
        <Pill tone="success">Accepted — {acceptedRiderName}</Pill>
      </div>
    );
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={openPicker}>
        Assign rider
      </Button>
    );
  }

  return (
    <div className="w-64 space-y-2 text-left">
      {loading ? (
        <p className="text-sm text-fg-muted">Loading riders…</p>
      ) : riders && riders.length === 0 ? (
        <p className="text-sm text-fg-muted">No verified riders available.</p>
      ) : (
        <>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full rounded-md border border-line bg-card px-2.5 py-2 text-sm"
          >
            {riders?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.fullName} — {r.vehicle} ({r.status}
                {r.cashOnHandCentavos > 0 ? `, ₱${(r.cashOnHandCentavos / 100).toFixed(0)} cash held` : ""}
                )
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" loading={submitting} onClick={sendOffer}>
              Send offer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
