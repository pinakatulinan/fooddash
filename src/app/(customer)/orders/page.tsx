import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, History, Receipt, ShoppingBag } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { OrderStatusPill } from "@/components/ui/status-pill";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { OrderHistoryCard, type OrderHistoryRow } from "@/components/customer/order-history-card";
import { isLive } from "@/lib/domain/order-status";
import { formatCentavos, formatManilaDate, formatRelative } from "@/lib/format";
import type { OrderStatus } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Your orders" };

const RECENT_PAST_COUNT = 5;
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
  total_centavos: number;
  created_at: string;
  placed_at: string | null;
  merchants: { name: string; logo_url: string | null } | null;
}

const SELECT = "id, code, status, total_centavos, created_at, placed_at, merchants(name, logo_url)";
// Richer than SELECT: the past-orders card shows what was ordered and a
// photo, which the in-progress list has no need for.
const PAST_SELECT =
  "id, code, status, total_centavos, created_at, delivered_at, cancelled_at, " +
  "merchants(name, cover_url), order_items(name_snapshot, quantity)";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { page: pageParam } = await searchParams;
  const pastPage = Math.max(1, Number(pageParam) || 1);
  const pastOffset = (pastPage - 1) * RECENT_PAST_COUNT;

  const supabase = await createClient();
  const { user } = await getCurrentUser();

  // RLS restricts both to the caller's own orders. Two targeted queries
  // instead of one big one filtered client-side: "in progress" is whatever
  // is actually still moving (never large in practice), and "past orders"
  // only ever pages through five at a time here - the full search view
  // lives on its own page (orders/history), same split as the merchant
  // orders console.
  const [{ data: activeData }, { data: pastData, count: pastCount }] = await Promise.all([
    supabase
      .from("orders")
      .select(SELECT)
      .in("status", IN_PROGRESS_STATUSES)
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select(PAST_SELECT, { count: "exact" })
      .in("status", PAST_STATUSES)
      .order("created_at", { ascending: false })
      .range(pastOffset, pastOffset + RECENT_PAST_COUNT - 1),
  ]);

  const active = (activeData ?? []) as unknown as Row[];
  const past = (pastData ?? []) as unknown as OrderHistoryRow[];
  const pastTotal = pastCount ?? 0;
  const pastTotalPages = Math.max(1, Math.ceil(pastTotal / RECENT_PAST_COUNT));
  const totalCount = active.length + pastTotal;

  return (
    <>
      {user && <RealtimeRefresh table="orders" filter={`customer_id=eq.${user.id}`} />}
      <ScreenHeader
        title="Your orders"
        subtitle={`${totalCount} in total`}
        titleClassName="font-bold"
        actions={
          user && (
            <Link
              href="/cart"
              aria-label="Your cart"
              className="relative grid size-10 place-items-center rounded-pill hover:bg-white/15"
            >
              <ShoppingBag aria-hidden className="size-5" />
            </Link>
          )
        }
      />

      <div className="space-y-8 px-4 py-6">
        {totalCount === 0 ? (
          <EmptyState
            icon={<Receipt className="size-6" />}
            title="No orders yet"
            description="When you order, you will be able to track it here and reorder in one tap."
            action={<LinkButton href="/">Find something to eat</LinkButton>}
          />
        ) : (
          <>
            <OrderList heading="In progress" orders={active} empty="Nothing in progress right now" />

            <section aria-labelledby="past-orders">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 id="past-orders" className="text-sm font-bold tracking-wide text-fg-muted uppercase">
                  Past orders
                </h2>
                {pastTotal > 0 && (
                  <LinkButton href="/orders/history" size="sm" variant="secondary">
                    <History aria-hidden className="size-3.5" /> Full history
                  </LinkButton>
                )}
              </div>

              {past.length === 0 ? null : (
                <>
                  <ul className="space-y-2">
                    {past.map((order) => (
                      <li key={order.id}>
                        <OrderHistoryCard order={order} />
                      </li>
                    ))}
                  </ul>

                  {pastTotalPages > 1 && (
                    <div className="mt-3 flex items-center justify-center gap-1">
                      {pastPage > 1 ? (
                        <Link
                          href={`/orders?page=${pastPage - 1}`}
                          aria-label="Previous orders"
                          className="grid size-8 place-items-center rounded-pill text-fg-muted hover:bg-surface-raised"
                        >
                          <ChevronLeft aria-hidden className="size-4" />
                        </Link>
                      ) : (
                        <span className="size-8" aria-hidden />
                      )}
                      <span className="px-2 text-xs font-medium text-fg-muted">
                        Page {pastPage} of {pastTotalPages}
                      </span>
                      {pastPage < pastTotalPages ? (
                        <Link
                          href={`/orders?page=${pastPage + 1}`}
                          aria-label="Next orders"
                          className="grid size-8 place-items-center rounded-pill text-fg-muted hover:bg-surface-raised"
                        >
                          <ChevronRight aria-hidden className="size-4" />
                        </Link>
                      ) : (
                        <span className="size-8" aria-hidden />
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function OrderList({ heading, orders, empty }: { heading: string; orders: Row[]; empty: string }) {
  return (
    <section aria-labelledby="in-progress">
      <h2 id="in-progress" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
        {heading}
      </h2>
      {orders.length === 0 ? (
        <p className="text-sm text-fg-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {orders.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OrderRow({ order }: { order: Row }) {
  return (
    <li>
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
          <p className="shrink-0 font-bold tabular-nums">{formatCentavos(order.total_centavos)}</p>
        </Link>
      </Card>
    </li>
  );
}
