"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Quantity editing for a line already in the cart.
 *
 * `AddToCartControl`'s own stepper only ever decides the quantity for a
 * brand-new row - `add_to_cart` never merges into an existing one - so it
 * can't be reused here. This instead updates the row directly:
 * `cart_items_own`'s RLS policy already covers UPDATE the same way it
 * covers DELETE (see `RemoveCartItemButton`), so there is nothing a stored
 * procedure would add. The 1-99 range is enforced twice on purpose - the
 * buttons disable at the edges for a clean UI, and `cart_items_quantity_range`
 * is the actual backstop if anything ever calls this outside the buttons.
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
    if (next < 1 || next > 99 || next === value || pending) return;
    const previous = value;
    setValue(next);
    setPending(true);

    const supabase = createClient();
    const { error } = await supabase.from("cart_items").update({ quantity: next }).eq("id", cartItemId);

    setPending(false);
    if (error) {
      setValue(previous);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex shrink-0 items-center rounded-md border border-line">
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => change(value - 1)}
        disabled={pending || value <= 1}
        className="grid size-8 place-items-center text-fg-muted hover:text-fg disabled:opacity-40"
      >
        <Minus aria-hidden className="size-3.5" />
      </button>
      <span className="w-6 text-center text-sm font-bold tabular-nums">{value}</span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => change(value + 1)}
        disabled={pending || value >= 99}
        className="grid size-8 place-items-center text-fg-muted hover:text-fg disabled:opacity-40"
      >
        <Plus aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}
