"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { CART_CHANGED_EVENT } from "@/lib/cart-events";

export interface CartSummary {
  itemCount: number;
  subtotalCentavos: number;
}

/**
 * The live cart summary, shared between BasketBar and the bottom nav's cart
 * badge - both need the same number (how many items, what they add up to)
 * and both need it to update the instant it changes, so this is the one
 * place that fetches it and stays subscribed, rather than two components
 * independently opening two Realtime channels for the same row.
 *
 * Kept up to date three ways: on mount, over Realtime (watching `carts` -
 * catches a change made from another tab/device), and via the same-tab
 * `cart-events` signal (catches a change made right here, faster than the
 * websocket round trip - see that module for why both exist).
 */
export function useCartSummary(): CartSummary | null {
  const [summary, setSummary] = React.useState<CartSummary | null>(null);

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

    // No address passed: callers only ever show a subtotal, which
    // price_cart computes regardless - the delivery fee it can't know
    // without one is not something either caller displays.
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
        .channel(`cart-summary:${user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "carts", filter: `user_id=eq.${user.id}` },
          () => load(),
        )
        .subscribe();
    }

    connect();
    window.addEventListener(CART_CHANGED_EVENT, load);

    return () => {
      cancelled = true;
      window.removeEventListener(CART_CHANGED_EVENT, load);
      if (channel) supabase.removeChannel(channel);
    };
  }, [load]);

  return summary;
}
