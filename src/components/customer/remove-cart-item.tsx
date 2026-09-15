"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Deletes one cart line directly against the table rather than through an
 * RPC — the `cart_items_own` RLS policy in migration 0009 already restricts
 * this to rows in the caller's own cart, so there is nothing a stored
 * procedure would add here.
 */
export function RemoveCartItemButton({ cartItemId }: { cartItemId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function handleRemove() {
    setPending(true);
    const supabase = createClient();
    await supabase.from("cart_items").delete().eq("id", cartItemId);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleRemove}
      disabled={pending}
      aria-label="Remove item"
      className="grid size-8 shrink-0 place-items-center rounded-pill text-fg-muted hover:bg-danger-tint hover:text-danger disabled:opacity-40"
    >
      <X aria-hidden className="size-4" />
    </button>
  );
}
