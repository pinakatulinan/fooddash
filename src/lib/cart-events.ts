"use client";

/**
 * A same-tab signal for "the cart just changed," fired alongside the real
 * write rather than instead of it.
 *
 * BasketBar already listens for this over Realtime (watching the `carts`
 * row), which is the right source of truth for a change made from another
 * tab or device. But a websocket round trip landing a beat late reads as
 * "add to cart is broken" when it happens in the same tab that just made the
 * change - the one place a result is knowable instantly, synchronously,
 * because the code right here is the thing that changed it. This event lets
 * that same-tab case skip the round trip instead of waiting on it.
 */
export const CART_CHANGED_EVENT = "fd:cart-changed";

export function notifyCartChanged() {
  window.dispatchEvent(new Event(CART_CHANGED_EVENT));
}
