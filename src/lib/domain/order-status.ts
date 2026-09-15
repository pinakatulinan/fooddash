import type { OrderStatus, OrderType } from "@/lib/types/domain";

/**
 * How each order status is presented, in one place.
 *
 * The same order is looked at by four different people who need four different
 * sentences: a customer wants reassurance, a merchant wants an instruction, a
 * rider wants the next physical action, ops wants the state name. Scattering
 * those strings across four route groups is how "Preparing" ends up meaning
 * something different on two screens.
 *
 * `tone` maps onto the design tokens, not onto raw colours:
 *   neutral - waiting on someone else
 *   active  - something is happening right now (coral)
 *   success - done, good outcome (mint)
 *   danger  - done, bad outcome
 */
export type StatusTone = "neutral" | "active" | "success" | "danger";

export interface StatusPresentation {
  tone: StatusTone;
  /** Terse label for pills and tables. */
  label: string;
  /** What the customer sees on the tracking screen. */
  customer: string;
  /** What the merchant console shows. */
  merchant: string;
  /** The rider's next physical action. */
  rider: string;
}

export const ORDER_STATUS: Record<OrderStatus, StatusPresentation> = {
  draft: {
    tone: "neutral",
    label: "Draft",
    customer: "Finishing your order",
    merchant: "Not submitted",
    rider: "—",
  },
  pending_payment: {
    tone: "neutral",
    label: "Awaiting payment",
    customer: "Waiting for your payment to clear",
    merchant: "Payment pending — do not start cooking yet",
    rider: "—",
  },
  placed: {
    tone: "active",
    label: "New order",
    customer: "Sent to the store",
    merchant: "New order — accept or decline",
    rider: "—",
  },
  accepted: {
    tone: "active",
    label: "Accepted",
    customer: "The store accepted your order",
    merchant: "Accepted — start preparing",
    rider: "Head to the store",
  },
  preparing: {
    tone: "active",
    label: "Preparing",
    customer: "Your food is being prepared",
    merchant: "Preparing — mark ready when packed",
    rider: "Wait at the store",
  },
  ready_for_pickup: {
    tone: "active",
    label: "Ready",
    customer: "Packed and waiting for a rider",
    merchant: "Ready — waiting for pickup",
    rider: "Collect the order",
  },
  picked_up: {
    tone: "active",
    label: "On the way",
    customer: "Your rider is on the way",
    merchant: "Picked up",
    rider: "Deliver to the customer",
  },
  arrived: {
    tone: "active",
    label: "Arrived",
    customer: "Your rider has arrived",
    merchant: "Rider at the customer",
    rider: "Hand over and confirm the code",
  },
  delivered: {
    tone: "success",
    label: "Delivered",
    customer: "Delivered — enjoy your meal",
    merchant: "Completed",
    rider: "Completed",
  },
  cancelled: {
    tone: "danger",
    label: "Cancelled",
    customer: "This order was cancelled",
    merchant: "Cancelled",
    rider: "Cancelled",
  },
  failed: {
    tone: "danger",
    label: "Failed",
    customer: "We could not complete this delivery",
    merchant: "Delivery failed",
    rider: "Marked as failed",
  },
};

/** The happy path, in order. Drives the customer's progress timeline. */
export const DELIVERY_TIMELINE: OrderStatus[] = [
  "placed",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "picked_up",
  "delivered",
];

export const PICKUP_TIMELINE: OrderStatus[] = [
  "placed",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "delivered",
];

export function isTerminal(status: OrderStatus): boolean {
  return status === "delivered" || status === "cancelled" || status === "failed";
}

/** Is this order still worth showing on a live board? */
export function isLive(status: OrderStatus): boolean {
  return !isTerminal(status) && status !== "draft";
}

/**
 * Mirrors `public.order_transition_allowed` in migration 0008. Used only to
 * decide which buttons to render - the database re-checks every transition and
 * is the authority. If these two ever disagree, the database wins and the UI
 * is the bug.
 */
export const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  placed: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready_for_pickup", "cancelled"],
  ready_for_pickup: ["picked_up", "delivered", "cancelled", "failed"],
  picked_up: ["arrived", "delivered", "failed"],
  arrived: ["delivered", "failed"],
};

export interface MerchantAction {
  to: OrderStatus;
  label: string;
  variant: "primary" | "danger";
  /** Prompted for and sent as advance_order's p_note when set. */
  reasonPrompt?: string;
}

/**
 * What a merchant may DO at each status - the subset of NEXT_STATUS that
 * `advance_order` actually grants to the merchant role, worded as a button
 * rather than a state name. A merchant may cancel at any live status; only a
 * rider can move an order past ready_for_pickup, except a pickup order's
 * final "delivered" step, which the merchant completes at the counter.
 *
 * This exists to decide which buttons to render. advance_order re-checks
 * every one of these server-side regardless - if the two ever disagree, the
 * database wins and this list is the bug.
 */
export function merchantActionsFor(status: OrderStatus, type: OrderType): MerchantAction[] {
  const cancel: MerchantAction = {
    to: "cancelled",
    label: status === "placed" ? "Decline" : "Cancel",
    variant: "danger",
    reasonPrompt:
      status === "placed"
        ? "Why are you declining this order? (shown to the customer)"
        : "Why are you cancelling this order? (shown to the customer)",
  };

  switch (status) {
    case "placed":
      return [{ to: "accepted", label: "Accept", variant: "primary" }, cancel];
    case "accepted":
      return [{ to: "preparing", label: "Start preparing", variant: "primary" }, cancel];
    case "preparing":
      return [{ to: "ready_for_pickup", label: "Mark ready", variant: "primary" }, cancel];
    case "ready_for_pickup":
      // A pickup order is completed by the merchant at the counter; a
      // delivery is waiting on a rider from here, so cancel is all that's left.
      return type === "pickup"
        ? [{ to: "delivered", label: "Mark picked up", variant: "primary" }, cancel]
        : [cancel];
    default:
      return [];
  }
}
