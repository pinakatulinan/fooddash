import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { OrderStatusPill } from "@/components/ui/status-pill";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { isLive } from "@/lib/domain/order-status";
import { formatCentavos, formatManilaDate, formatRelative } from "@/lib/format";
import type { OrderStatus } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Your orders" };

interface Row {
  id: string;
  code: string;
  status: OrderStatus;
  total_centavos: number;
  created_at: string;
  placed_at: string | null;
  merchants: { name: string; logo_url: string | null } | null;
}

export default async function OrdersPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const { user } = await getCurrentUser();
  // RLS restricts this to the caller's own orders.
  const { data } = await supabase
    .from("orders")
    .select("id, code, status, total_centavos, created_at, placed_at, merchants(name, logo_url)")
    .order("created_at", { ascending: false })
    .limit(50);

  const orders = (data ?? []) as unknown as Row[];
  const active = orders.filter((o) => isLive(o.status));
  const past = orders.filter((o) => !isLive(o.status));

  return (
    <>
      {user && <RealtimeRefresh table="orders" filter={`customer_id=eq.${user.id}`} />}
      <ScreenHeader title="Your orders" subtitle={`${orders.length} in total`} />

      <div className="space-y-8 px-4 py-6">
        {orders.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-6" />}
            title="No orders yet"
            description="When you order, you will be able to track it here and reorder in one tap."
            action={<LinkButton href="/">Find something to eat</LinkButton>}
          />
        ) : (
          <>
            <OrderList heading="In progress" orders={active} />
            <OrderList heading="Past orders" orders={past} />
          </>
        )}
      </div>
    </>
  );
}

function OrderList({ heading, orders }: { heading: string; orders: Row[] }) {
  if (orders.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">{heading}</h2>
      <ul className="space-y-2">
        {orders.map((order) => (
          <li key={order.id}>
            <Card interactive>
              <Link href={`/orders/${order.id}`} className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{order.merchants?.name ?? "Store"}</span>
                    <OrderStatusPill status={order.status} audience="customer" />
                  </div>
                  <p className="mt-1 font-mono text-xs text-fg-muted">
                    {order.code} ·{" "}
                    {isLive(order.status)
                      ? formatRelative(order.placed_at ?? order.created_at)
                      : formatManilaDate(order.created_at)}
                  </p>
                </div>
                <p className="shrink-0 font-bold tabular-nums">
                  {formatCentavos(order.total_centavos)}
                </p>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
