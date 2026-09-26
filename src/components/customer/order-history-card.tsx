import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import { Card } from "@/components/ui/card";
import { OrderStatusPill } from "@/components/ui/status-pill";
import { formatCentavos, formatManilaDate } from "@/lib/format";
import type { OrderStatus } from "@/lib/types/domain";

export interface OrderHistoryRow {
  id: string;
  code: string;
  status: OrderStatus;
  total_centavos: number;
  created_at: string;
  delivered_at: string | null;
  cancelled_at: string | null;
  merchants: { name: string; cover_url: string | null } | null;
  order_items: { name_snapshot: string; quantity: number }[];
}

/** "2× Adobo Rice, 1× Iced Tea +1 more" - the first couple of items, not the
    whole receipt, so a card stays a card and not a second items list. */
function summariseItems(items: { name_snapshot: string; quantity: number }[]): string {
  const shown = items.slice(0, 2).map((i) => `${i.quantity}× ${i.name_snapshot}`);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest} more` : shown.join(", ");
}

/** What actually happened to this order and when - "Delivered" only means
    something for an order that was, and a cancelled/failed one reads its
    own reason instead of a delivery date it never reached. */
function whenLabel(order: OrderHistoryRow): string {
  if (order.status === "delivered") {
    return `Delivered ${formatManilaDate(order.delivered_at ?? order.created_at)}`;
  }
  if (order.status === "cancelled") {
    return `Cancelled ${formatManilaDate(order.cancelled_at ?? order.created_at)}`;
  }
  if (order.status === "failed") {
    return `Delivery failed · ${formatManilaDate(order.created_at)}`;
  }
  return formatManilaDate(order.created_at);
}

/**
 * One past order, as a receipt-shaped card: the store's own photo (not its
 * icon-scale logo - this is a box, not a list row), what it cost, when it
 * actually resolved, and a peek at what was ordered. Tapping through goes to
 * the full itemised breakdown on the order detail page.
 */
export function OrderHistoryCard({ order }: { order: OrderHistoryRow }) {
  return (
    <Card interactive>
      <Link href={`/orders/${order.id}`} className="flex gap-3 p-3">
        <div className="size-16 shrink-0 overflow-hidden rounded-md bg-coral-tint">
          {order.merchants?.cover_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={order.merchants.cover_url} alt="" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center">
              <UtensilsCrossed aria-hidden className="size-6 text-primary/40" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="truncate font-bold">{order.merchants?.name ?? "Store"}</span>
            <span className="shrink-0 font-bold tabular-nums">{formatCentavos(order.total_centavos)}</span>
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">{whenLabel(order)}</p>
          {order.order_items.length > 0 && (
            <p className="mt-1 truncate text-sm text-fg-muted">{summariseItems(order.order_items)}</p>
          )}
          <div className="mt-1.5">
            <OrderStatusPill status={order.status} audience="customer" />
          </div>
        </div>
      </Link>
    </Card>
  );
}
