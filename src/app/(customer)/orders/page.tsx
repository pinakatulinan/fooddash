import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { OrdersTabs } from "@/components/customer/orders-tabs";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { DELIVERY_TIMELINE, ORDER_STATUS, PICKUP_TIMELINE } from "@/lib/domain/order-status";
import { cn } from "@/lib/utils";
import type { OrderStatus, OrderType } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Your orders" };

const IN_PROGRESS_STATUSES = [
  "draft",
  "pending_payment",
  "placed",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "picked_up",
  "arrived",
] as const;
const PAST_STATUSES = ["delivered", "cancelled", "failed"] as const;

interface Row {
  id: string;
  code: string;
  status: OrderStatus;
  type: OrderType;
  total_centavos: number;
  promised_at: string | null;
  merchants: { name: string; logo_url: string | null } | null;
  order_items: { id: string }[];
}

const SELECT = "id, code, status, type, total_centavos, promised_at, merchants(name, logo_url), order_items(id)";

/** Kept out of the component body deliberately - reading the clock during
    render is impure, and the React compiler is right to complain about it
    even here where the component only ever runs once per request. */
function minutesUntil(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

export default async function OrdersPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const { user } = await getCurrentUser();

  // RLS restricts both to the caller's own orders. The "Past" count here is
  // head-only - just enough to know whether this account has ever ordered,
  // not to render anything - the actual past list lives on /orders/history
  // behind the Past tab.
  const [{ data: activeData }, { count: pastCount }] = await Promise.all([
    supabase
      .from("orders")
      .select(SELECT)
      .in("status", IN_PROGRESS_STATUSES)
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("status", PAST_STATUSES),
  ]);

  const active = (activeData ?? []) as unknown as Row[];
  const totalCount = active.length + (pastCount ?? 0);

  return (
    <>
      {user && <RealtimeRefresh table="orders" filter={`customer_id=eq.${user.id}`} />}

      <div className="px-5 pt-3 pb-3">
        <h1 className="text-[26px] font-extrabold tracking-[-0.01em]">Orders</h1>
      </div>

      {totalCount === 0 ? (
        <EmptyState
          icon={<Receipt className="size-6" />}
          title="No orders yet"
          description="When you order, you will be able to track it here and reorder in one tap."
          action={<LinkButton href="/">Find something to eat</LinkButton>}
        />
      ) : (
        <div className="space-y-5 px-5 pb-6">
          <OrdersTabs active="active" activeCount={active.length} />

          {active.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">Nothing in progress right now.</p>
          ) : (
            <ul className="space-y-2.5">
              {active.map((order) => (
                <ActiveOrderCard key={order.id} order={order} />
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function ActiveOrderCard({ order }: { order: Row }) {
  const steps = order.type === "pickup" ? PICKUP_TIMELINE : DELIVERY_TIMELINE;
  const currentIndex = steps.indexOf(order.status);
  const eta = order.promised_at ? minutesUntil(order.promised_at) : null;

  return (
    <li>
      <Link href={`/orders/${order.id}`} className="block rounded-[22px] bg-fg p-4 text-white">
        <div className="flex items-center gap-3.5">
          {order.merchants?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={order.merchants.logo_url} alt="" className="size-11 shrink-0 rounded-pill object-cover" />
          ) : (
            <div className="size-11 shrink-0 rounded-pill bg-white/15" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold">{order.merchants?.name ?? "Store"}</p>
            <p className="mt-0.5 font-mono text-xs text-white/75">
              {order.code} · {order.order_items.length} items
            </p>
          </div>
          {eta != null && (
            <div className="shrink-0 text-right">
              <p className="text-xl font-extrabold tabular-nums">
                {eta}
                <span className="text-xs font-semibold"> min</span>
              </p>
            </div>
          )}
        </div>

        <div className="mt-3.5 flex gap-1">
          {steps.map((step, i) => (
            <span
              key={step}
              aria-hidden
              className={cn(
                "h-1.25 flex-1 rounded-[3px]",
                i < currentIndex ? "bg-mint-mark" : i === currentIndex ? "bg-primary" : "bg-[#3A3A3A]",
              )}
            />
          ))}
        </div>
        <p className="mt-2 text-[13px] font-medium text-white/85">{ORDER_STATUS[order.status].customer}</p>
      </Link>
    </li>
  );
}
