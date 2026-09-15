"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Pill } from "@/components/ui/status-pill";

/**
 * A promo is never deleted from here - promo_redemptions cascades on delete,
 * which would erase real redemption history. Deactivating keeps the row (and
 * every past use of it) intact while stopping new redemptions.
 */
export function TogglePromoActive({ promoId, isActive }: { promoId: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("promos")
      .update({ is_active: !isActive })
      .eq("id", promoId);
    setPending(false);

    if (updateError) {
      setError(friendlyError(updateError));
      return;
    }
    router.refresh();
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="disabled:opacity-50"
        aria-label={isActive ? "Deactivate promo" : "Activate promo"}
      >
        <Pill tone={isActive ? "success" : "neutral"}>{isActive ? "Active" : "Paused"}</Pill>
      </button>
      {error && <p className="mt-1 text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}
