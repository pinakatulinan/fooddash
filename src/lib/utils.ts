import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes so a caller's `className` always wins over a
 * component's defaults, instead of both landing in the class list and the
 * outcome depending on stylesheet order.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Narrow a Supabase PostgREST/RPC error into something worth showing a user. */
export function friendlyError(error: unknown): string {
  if (!error) return "Something went wrong. Please try again.";

  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "";

  // The database raises these deliberately; each one maps to a real situation
  // a customer, merchant or rider can act on.
  const known: Record<string, string> = {
    cart_not_found: "That cart no longer exists.",
    cart_empty: "Your cart is empty.",
    not_your_cart: "That cart belongs to someone else.",
    cart_belongs_to_another_store:
      "Your cart has items from another store. Start a new order to continue.",
    item_unavailable: "That item just sold out.",
    merchant_closed: "This store is not accepting orders right now.",
    below_minimum: "Your order is below this store's minimum.",
    address_required: "Choose a delivery address first.",
    outside_service_area: "We do not deliver to that address yet.",
    outside_merchant_radius: "This store does not deliver that far.",
    promo_invalid: "That promo code cannot be used on this order.",
    not_a_rider: "This account is not set up as a rider.",
    assignment_not_found: "That delivery offer no longer exists.",
    not_your_assignment: "That offer was made to another rider.",
    order_not_found: "We could not find that order.",
    not_authorised: "You do not have access to that.",
  };

  for (const [code, friendly] of Object.entries(known)) {
    if (message.includes(code)) return friendly;
  }

  // A signed-out visitor on a public page (the store page, for instance) can
  // reach a button that calls a function granted only to `authenticated`.
  // Postgres refuses with "permission denied" and PostgREST surfaces it as a
  // 401 - this is the backstop for whichever call site did not catch that
  // ahead of time and prompt a sign-in instead.
  if (message.includes("permission denied") || message.includes("JWT")) {
    return "Please sign in to continue.";
  }

  // Anything raised with `raise exception 'plain english...'` is already
  // written for a human, so pass it through rather than swallowing it.
  if (message && !message.startsWith("{") && message.length < 200) return message;

  return "Something went wrong. Please try again.";
}
