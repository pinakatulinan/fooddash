"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, ShoppingBag } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CART_CHANGED_EVENT } from "@/lib/cart-events";
import { cn } from "@/lib/utils";
import { formatCentavos } from "@/lib/format";

interface Summary {
  itemCount: number;
  subtotalCentavos: number;
}

/**
 * A persistent basket bar, not a one-off popup: it appears the moment
 * there's anything in the cart and stays visible everywhere in the customer
 * app - browsing another store's menu, the search page, home - until the
 * order is actually placed. `place_order` deletes the cart row on checkout
 * (0008), which is exactly the signal this listens for to disappear.
 *
 * Deliberately just a name, a count and a total - tapping it goes straight
 * to /cart. Editing the basket happens there, not in a second copy of it
 * living in this bar.
 */
export function BasketBar() {
  const pathname = usePathname();
  const [summary, setSummary] = React.useState<Summary | null>(null);

  const load = React.useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: cart } = await supabase
      .from("carts")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!cart) {
      setSummary(null);
      return;
    }

    // No address passed: this bar only ever shows a subtotal, which
    // price_cart computes regardless - the delivery fee it can't know
    // without one is not something this bar displays anyway.
    const { data } = await supabase.rpc("price_cart", {
      p_cart_id: cart.id,
      p_address_id: null,
      p_promo_code: null,
      p_tip_centavos: 0,
      p_order_type: "delivery",
    });
    const quote = data as { lines: { quantity: number }[]; subtotal_centavos: number } | null;

    if (!quote || quote.lines.length === 0) {
      setSummary(null);
      return;
    }
    setSummary({
      itemCount: quote.lines.reduce((n, l) => n + l.quantity, 0),
      subtotalCentavos: quote.subtotal_centavos,
    });
  }, []);

  React.useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function connect() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      load();

      // Same startup-race fix as RealtimeRefresh: set the socket's auth
      // explicitly before subscribing.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      // carts.updated_at is touched by touch_parent_cart() on every
      // cart_items insert/update/delete (0004), so watching this one table
      // catches an add, a removal, or checkout deleting the row outright -
      // from whichever page triggered it, not just this one.
      channel = supabase
        .channel(`basket-bar:${user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "carts", filter: `user_id=eq.${user.id}` },
          () => load(),
        )
        .subscribe();
    }

    connect();

    // The direct, same-tab signal - see lib/cart-events.ts for why this
    // exists alongside the Realtime subscription above rather than instead
    // of it.
    window.addEventListener(CART_CHANGED_EVENT, load);

    return () => {
      cancelled = true;
      window.removeEventListener(CART_CHANGED_EVENT, load);
      if (channel) supabase.removeChannel(channel);
    };
  }, [load]);

  // Keeps showing the last real numbers while sliding out, rather than the
  // content going blank a beat before the bar itself finishes disappearing.
  // Adjusted during render rather than in an effect - see CartItemQuantity
  // for the same pattern and why.
  const [lastSummary, setLastSummary] = React.useState<Summary | null>(null);
  if (summary && summary !== lastSummary) {
    setLastSummary(summary);
  }

  // Redundant on the page that already is the basket.
  const onCartFlow = pathname?.startsWith("/cart") || pathname?.startsWith("/checkout");
  const visible = !onCartFlow && !!summary;
  const display = summary ?? lastSummary;

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-6",
        "transition-[transform,opacity] duration-300 ease-out",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      {display && (
        <Link
          href="/cart"
          tabIndex={visible ? undefined : -1}
          className="flex w-full max-w-md items-center gap-3 rounded-pill bg-header px-4 py-3 text-header-fg shadow-lg transition-transform active:scale-[0.98]"
        >
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-pill bg-white/15">
            <ShoppingBag className="size-4" />
          </span>
          <span className="min-w-0 flex-1 text-sm font-bold">
            Basket · {display.itemCount} {display.itemCount === 1 ? "item" : "items"}
          </span>
          <span className="shrink-0 text-sm font-bold tabular-nums">{formatCentavos(display.subtotalCentavos)}</span>
          <ChevronRight aria-hidden className="size-4 shrink-0 opacity-70" />
        </Link>
      )}
    </div>
  );
}
