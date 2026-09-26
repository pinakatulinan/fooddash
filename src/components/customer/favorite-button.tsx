"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Toggles a row in `favorites` for the signed-in customer. Optimistic: the
 * heart fills immediately and only reverts if the write actually fails,
 * since the common case (it succeeds) should feel instant, not round-trip
 * before the icon moves.
 *
 * A signed-out visitor can still browse a store page (RLS allows it), so
 * this is reachable without a session - tapping it then sends them to sign
 * in rather than failing silently against a table `anon` has no grant on.
 */
export function FavoriteButton({
  merchantId,
  initialFavorited,
  className,
  onChange,
}: {
  merchantId: string;
  initialFavorited: boolean;
  className?: string;
  /** Fires after a write actually succeeds - e.g. the favorites list uses
      this to drop a card the moment it's unfavorited, instead of leaving a
      stale card with an empty heart until the next page load. */
  onChange?: (favorited: boolean) => void;
}) {
  const router = useRouter();
  const [favorited, setFavorited] = React.useState(initialFavorited);
  const [pending, setPending] = React.useState(false);

  async function toggle() {
    if (pending) return;
    setPending(true);
    const next = !favorited;
    setFavorited(next);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setFavorited(!next);
      setPending(false);
      router.push("/login");
      return;
    }

    const { error } = next
      ? await supabase.from("favorites").insert({ customer_id: user.id, merchant_id: merchantId })
      : await supabase.from("favorites").delete().eq("customer_id", user.id).eq("merchant_id", merchantId);

    if (error) {
      setFavorited(!next);
    } else {
      onChange?.(next);
    }
    setPending(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={favorited}
      aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-pill transition-transform active:scale-90",
        "hover:bg-white/15 disabled:opacity-60",
        className,
      )}
    >
      <Heart aria-hidden className={cn("size-5", favorited && "fill-current")} />
    </button>
  );
}
