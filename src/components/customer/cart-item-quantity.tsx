"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyCartChanged } from "@/lib/cart-events";

/**
 * Quantity editing for a line already in the cart - and its removal, now one
 * control instead of two. Dropping to zero and tapping "remove" are the same
 * user intent ("I don't want this line anymore"), so the bottom button just
 * becomes the trash icon at quantity 1 rather than disabling.
 *
 * `AddToCartControl`'s own stepper only ever decides the quantity for a
 * brand-new row - `add_to_cart` never merges into an existing one - so it
 * can't be reused here. This instead updates the row directly:
 * `cart_items_own`'s RLS policy already covers UPDATE the same way it
 * covers DELETE, so there is nothing a stored procedure would add. The 1-99
 * range is enforced twice on purpose - the buttons disable at the edges for
 * a clean UI, and `cart_items_quantity_range` is the actual backstop if
 * anything ever calls this outside the buttons.
 */
export function CartItemQuantity({ cartItemId, quantity }: { cartItemId: string; quantity: number }) {
  const router = useRouter();
  const [value, setValue] = React.useState(quantity);
  const [pending, setPending] = React.useState(false);

  // The server is the source of truth after every refresh - a prop change
  // from outside (the whole cart reloading with fresh prices) should win
  // over any stale local optimistic value. Adjusted during render rather
  // than in an effect, per React's own guidance for this exact case - an
  // effect here would mean one extra render on every prop change.
  const [prevQuantity, setPrevQuantity] = React.useState(quantity);
  if (quantity !== prevQuantity) {
    setPrevQuantity(quantity);
    setValue(quantity);
  }

  async function change(next: number) {
    if (next > 99 || next === value || pending) return;
    const previous = value;
    setPending(true);

    const supabase = createClient();
    if (next < 1) {
      const { error } = await supabase.from("cart_items").delete().eq("id", cartItemId);
      if (error) {
        setPending(false);
        return;
      }
    } else {
      setValue(next);
      const { error } = await supabase.from("cart_items").update({ quantity: next }).eq("id", cartItemId);
      if (error) {
        setPending(false);
        setValue(previous);
        return;
      }
    }

    setPending(false);
    notifyCartChanged();
    router.refresh();
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5 rounded-[14px] bg-cream p-1">
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => change(value + 1)}
        disabled={pending || value >= 99}
        className="grid size-7 place-items-center rounded-[10px] bg-primary text-primary-fg disabled:opacity-40"
      >
        <Plus aria-hidden className="size-3.5" />
      </button>
      <span className="text-[13px] font-bold tabular-nums">{value}</span>
      <button
        type="button"
        aria-label={value <= 1 ? "Remove item" : "Decrease quantity"}
        onClick={() => change(value - 1)}
        disabled={pending}
        className="grid size-7 place-items-center rounded-[10px] bg-card text-fg-muted shadow-card disabled:opacity-40"
      >
        {value <= 1 ? <Trash2 aria-hidden className="size-3.5" /> : <Minus aria-hidden className="size-3.5" />}
      </button>
    </div>
  );
}
