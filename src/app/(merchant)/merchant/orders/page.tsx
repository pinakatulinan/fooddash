import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CookingPot, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentMerchant } from "@/lib/merchant";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { OrderStatusPill } from "@/components/ui/status-pill";
import { LinkButton } from "@/components/ui/button";
import { OrderActions } from "@/components/merchant/order-actions";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { formatCentavos, formatManilaTime, formatRelative } from "@/lib/format";
import type { OrderStatus } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Orders" };

const RECENT_COMPLETED_COUNT = 5;
const LIVE_STATUSES = ["placed", "accepted", "preparing", "ready_for_pickup", "picked_up", "arrived"] as const;
const TERMINAL_STATUSES = ["delivered", "cancelled", "failed"] as const;

interface Row {
  id: string;
  code: string;
  status: OrderStatus;
  type: "delivery" | "pickup";
  total_centavos: number;
  placed_at: string | null;
  promised_at: string | null;
  delivery_address: { line1?: string; barangay?: string } | null;
}

const SELECT = "id, code, status, type, total_centavos, placed_at, promised_at, delivery_address";

export default async function MerchantOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { page: pageParam } = await searchParams;
  const donePage = Math.max(1, Number(pageParam) || 1);
  const doneOffset = (donePage - 1) * RECENT_COMPLETED_COUNT;

  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return (
      <>
        <ScreenHeader title="Orders" />
        <EmptyState
          icon={<CookingPot className="size-6" />}
          title="No store linked to this account"
          description="Create a store to start taking orders."
        />
      </>
    );
  }

  const supabase = await createClient();

  // Two targeted queries instead of one big one filtered client-side: the
  // live queue is whatever is actually in flight (never large in practice),
  // and "recent completed" only ever pages through five at a time here - the
  // full search-and-filter view lives on its own page (orders/history).
  const [{ data: liveData }, { data: doneData, count: doneCount }] = await Promise.all([
    supabase
      .from("orders")
      .select(SELECT)
      .eq("merchant_id", merchant.id)
      .in("status", LIVE_STATUSES)
      .order("placed_at", { ascending: true }),
    supabase
      .from("orders")
      .select(SELECT, { count: "exact" })
      .eq("merchant_id", merchant.id)
      .in("status", TERMINAL_STATUSES)
      .order("placed_at", { ascending: false, nullsFirst: false })
      .range(doneOffset, doneOffset + RECENT_COMPLETED_COUNT - 1),
  ]);

  const live = (liveData ?? []) as Row[];
  const done = (doneData ?? []) as Row[];
  const doneTotalPages = Math.max(1, Math.ceil((doneCount ?? 0) / RECENT_COMPLETED_COUNT));

  const columns = [
    { key: "code", label: "Order", mono: true },
    { key: "status", label: "Status" },
    { key: "where", label: "Destination", hideOnMobile: true },
    { key: "due", label: "Due", hideOnMobile: true },
    { key: "total", label: "Total", align: "right" as const, mono: true },
  ];

  const toRow = (o: Row) => ({
    code: <span className="font-bold">{o.code}</span>,
    status: <OrderStatusPill status={o.status} audience="merchant" />,
    where: o.type === "pickup" ? "Customer pickup" : (o.delivery_address?.line1 ?? "Delivery"),
    due: o.promised_at ? formatManilaTime(o.promised_at) : formatRelative(o.placed_at),
    total: formatCentavos(o.total_centavos),
  });

  const liveColumns = [...columns, { key: "actions", label: "", align: "right" as const }];
  const toLiveRow = (o: Row) => ({
    ...toRow(o),
    actions: <OrderActions orderId={o.id} status={o.status} type={o.type} compact />,
  });

  return (
    <>
      <RealtimeRefresh table="orders" filter={`merchant_id=eq.${merchant.id}`} />

      <ScreenHeader title="Orders" subtitle={`${live.length} in the queue`} />

      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6">
        <section aria-labelledby="live">
          <h2 id="live" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Live queue
          </h2>
          <DataTable
            columns={liveColumns}
            rows={live.map(toLiveRow)}
            empty="Nothing cooking"
            emptyDescription="New orders appear here the moment a customer places one."
          />
        </section>

        <section aria-labelledby="history">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="history" className="text-sm font-bold tracking-wide text-fg-muted uppercase">
              Recently completed
            </h2>
            <LinkButton href="/merchant/orders/history" size="sm" variant="secondary">
              <History aria-hidden className="size-3.5" /> Full history
            </LinkButton>
          </div>
          <DataTable columns={columns} rows={done.map(toRow)} empty="No completed orders yet" />

          {done.length > 0 && doneTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-1">
              {donePage > 1 ? (
                <Link
                  href={`/merchant/orders?page=${donePage - 1}`}
                  aria-label="Previous orders"
                  className="grid size-8 place-items-center rounded-pill text-fg-muted hover:bg-surface-raised"
                >
                  <ChevronLeft aria-hidden className="size-4" />
                </Link>
              ) : (
                <span className="size-8" aria-hidden />
              )}
              <span className="px-2 text-xs font-medium text-fg-muted">
                Page {donePage} of {doneTotalPages}
              </span>
              {donePage < doneTotalPages ? (
                <Link
                  href={`/merchant/orders?page=${donePage + 1}`}
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
        </section>
      </div>
    </>
  );
}
