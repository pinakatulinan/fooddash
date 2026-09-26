"use client";

import * as React from "react";
import { Card, CardBody } from "@/components/ui/card";
import { OrderStatusPill } from "@/components/ui/status-pill";
import { OrderActions } from "@/components/merchant/order-actions";
import { formatCentavos, formatManilaTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types/domain";

interface LiveOrder {
  id: string;
  code: string;
  status: OrderStatus;
  total_centavos: number;
  placed_at: string | null;
  promised_at: string | null;
  type: "delivery" | "pickup";
  delivery_address: { landmark?: string; line1?: string } | null;
}

/**
 * A merchant-specific read on urgency, distinct from ORDER_STATUS's generic
 * tone (which lumps every non-terminal status into one "active" bucket): on
 * this board "placed" means you owe a decision, "accepted/preparing/ready"
 * means you're already on it, and "picked_up/arrived" means it's the
 * rider's problem now - three different things a merchant scans for, not one.
 */
const BORDER_TONE: Partial<Record<OrderStatus, string>> = {
  placed: "border-l-primary",
  accepted: "border-l-accent-fg",
  preparing: "border-l-accent-fg",
  ready_for_pickup: "border-l-accent-fg",
  picked_up: "border-l-line",
  arrived: "border-l-line",
};

/**
 * Flags rows that appeared since this component mounted - a plain prop diff
 * against a ref, not a timer: the class is added once and never removed, so
 * there is nothing to race against a fast follow-up refresh. The flash
 * itself is a one-shot CSS animation (globals.css, fd-new-row) that ends on
 * "forwards" and simply holds there, so a permanently-attached class looks
 * identical to a removed one once it has played.
 */
export function LiveQueueList({ orders }: { orders: LiveOrder[] }) {
  const seenRef = React.useRef<Set<string> | null>(null);
  const mountedRef = React.useRef(false);
  const [flashIds, setFlashIds] = React.useState<Set<string>>(() => new Set());

  if (seenRef.current === null) {
    seenRef.current = new Set(orders.map((o) => o.id));
  }

  React.useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const seen = seenRef.current!;
    const arrived = orders.filter((o) => !seen.has(o.id));
    if (arrived.length === 0) return;
    for (const o of arrived) seen.add(o.id);
    setFlashIds((prev) => {
      const next = new Set(prev);
      for (const o of arrived) next.add(o.id);
      return next;
    });
  }, [orders]);

  return (
    <ul className="space-y-2">
      {orders.map((order) => (
        <li key={order.id}>
          <Card
            className={cn(
              "border-l-4",
              BORDER_TONE[order.status] ?? "border-l-line",
              flashIds.has(order.id) && "fd-new-row",
            )}
          >
            <CardBody className="p-4">
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold">{order.code}</span>
                    <OrderStatusPill status={order.status} audience="merchant" />
                  </div>
                  <p className="mt-1 truncate text-sm text-fg-muted">
                    {order.type === "pickup"
                      ? "Customer pickup"
                      : (order.delivery_address?.line1 ?? "Delivery")}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-bold">{formatCentavos(order.total_centavos)}</p>
                  <p className="text-xs text-fg-muted">
                    {order.promised_at
                      ? `Due ${formatManilaTime(order.promised_at)}`
                      : formatRelative(order.placed_at)}
                  </p>
                </div>
              </div>
              <OrderActions orderId={order.id} status={order.status} type={order.type} />
            </CardBody>
          </Card>
        </li>
      ))}
    </ul>
  );
}
