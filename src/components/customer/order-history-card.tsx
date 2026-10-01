import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
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
  merchants: { name: string; slug: string; logo_url: string | null } | null;
}

/** What actually happened to this order and when - "Delivered" only means
    something for an order that was, and a cancelled/failed one reads its
    own reason instead of a delivery date it never reached. */
function whenLabel(order: OrderHistoryRow): string {
  if (order.status === "delivered") {
    return formatManilaDate(order.delivered_at ?? order.created_at);
  }
  if (order.status === "cancelled") {
    return formatManilaDate(order.cancelled_at ?? order.created_at);
  }
  return formatManilaDate(order.created_at);
}

/**
 * One past order, as a compact receipt row: logo, what it cost, when it
 * resolved, and its outcome - tapping through goes to the full itemised
 * breakdown on the order detail page. "Reorder" is a shortcut back to the
 * store's menu, not an automatic cart rebuild - the app has no such RPC, and
 * a visual refresh is not the place to invent one.
 */
export function OrderHistoryCard({ order }: { order: OrderHistoryRow }) {
  return (
    <div className="flex items-center gap-3 rounded-[20px] bg-card p-3.5 shadow-card">
      <Link href={`/orders/${order.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <div className="size-11 shrink-0 overflow-hidden rounded-pill bg-coral-tint">
          {order.merchants?.logo_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={order.merchants.logo_url} alt="" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center">
              <UtensilsCrossed aria-hidden className="size-4.5 text-primary/40" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{order.merchants?.name ?? "Store"}</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {whenLabel(order)} · {formatCentavos(order.total_centavos)}
          </p>
          <div className="mt-1.5">
            <OrderStatusPill status={order.status} audience="customer" />
          </div>
        </div>
      </Link>
      {order.merchants && (
        <Link
          href={`/store/${order.merchants.slug}`}
          className="shrink-0 rounded-xl bg-coral-tint px-3 py-2 text-xs font-bold text-primary"
        >
          Reorder
        </Link>
      )}
    </div>
  );
}
