import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DataTable, StatRow } from "@/components/ui/data-table";
import { OrderStatusPill } from "@/components/ui/status-pill";
import { LinkButton } from "@/components/ui/button";
import { AssignRider } from "@/components/admin/assign-rider";
import { CancelOrderAdmin } from "@/components/admin/cancel-order";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { formatCentavos, formatManilaDate, formatRelative } from "@/lib/format";
import type { OrderStatus } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Orders" };

const RECENT_PAST_COUNT = 5;
const LIVE_STATUSES = ["placed", "accepted", "preparing", "ready_for_pickup", "picked_up", "arrived"] as const;
const PAST_STATUSES = ["delivered", "cancelled", "failed"] as const;

interface Row {
  id: string;
  code: string;
  status: OrderStatus;
  type: "delivery" | "pickup";
  payment_method: string;
  payment_status: string;
  total_centavos: number;
  created_at: string;
  placed_at: string | null;
  merchants: { name: string } | null;
}

const SELECT =
  "id, code, status, type, payment_method, payment_status, total_centavos, created_at, placed_at, merchants(name)";

// Manual dispatch only makes sense while an order is somewhere between
// "the kitchen has it" and "a rider is already carrying it".
const DISPATCHABLE: OrderStatus[] = ["placed", "accepted", "preparing", "ready_for_pickup"];

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { page: pageParam } = await searchParams;
  const pastPage = Math.max(1, Number(pageParam) || 1);
  const pastOffset = (pastPage - 1) * RECENT_PAST_COUNT;

  const supabase = await createClient();

  // Same split as the merchant and customer orders pages: live orders (never
  // large in practice - ops is watching them right now) unpaginated, and
  // "recently completed" paging five at a time - the full searchable log
  // lives on its own page (orders/history), same reasoning throughout.
  const [
    { data: liveData },
    { data: pastData, count: pastCount },
    { data: assignmentRows },
    { count: deliveredCount },
    { count: endedCount },
    { data: gmvRows },
  ] = await Promise.all([
    supabase.from("orders").select(SELECT).in("status", LIVE_STATUSES).order("placed_at", { ascending: true }),
    supabase
      .from("orders")
      .select(SELECT, { count: "exact" })
      .in("status", PAST_STATUSES)
      .order("created_at", { ascending: false })
      .range(pastOffset, pastOffset + RECENT_PAST_COUNT - 1),
    // Only 'accepted' - a rider genuinely has this order until it is
    // delivered or cancelled, so it is safe to treat as blocking here.
    //
    // 'offered' is deliberately excluded. Whether an offer is still live
    // depends on comparing its expires_at to *now*, and "now" here would mean
    // this Next.js server's own clock - which has no guaranteed relationship
    // to the database's clock the way a value computed by Postgres itself
    // does. offer_order_to_rider() already self-heals a stale 'offered' row
    // against the database's own now() the moment anyone tries to
    // re-dispatch, so the AssignRider button is simply always shown instead:
    // ops can always attempt it, and a genuinely still-live offer is reported
    // back as a real error from that same, trustworthy check.
    supabase
      .from("delivery_assignments")
      // riders has two FKs to profiles (id, and verified_by) - name the one
      // PostgREST should use, or it refuses the embed as ambiguous.
      .select("order_id, status, riders(profiles!riders_id_fkey(full_name))")
      .eq("status", "accepted"),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "delivered"),
    supabase.from("orders").select("id", { count: "exact", head: true }).in("status", ["cancelled", "failed"]),
    // Just the one column, for the GMV sum below - PostgREST has no SUM
    // aggregate, and a platform lifetime total is worth getting right rather
    // than approximating from whatever page happens to be on screen.
    supabase.from("orders").select("total_centavos").eq("status", "delivered"),
  ]);

  const live = (liveData ?? []) as unknown as Row[];
  const past = (pastData ?? []) as unknown as Row[];
  const pastTotal = pastCount ?? 0;
  const pastTotalPages = Math.max(1, Math.ceil(pastTotal / RECENT_PAST_COUNT));
  const gmv = (gmvRows ?? []).reduce((s, o) => s + o.total_centavos, 0);

  const acceptedRiderByOrder = new Map(
    (assignmentRows ?? []).map((a) => [
      a.order_id,
      (a.riders as unknown as { profiles: { full_name: string | null } })?.profiles?.full_name ?? "Unnamed rider",
    ]),
  );

  const columns = [
    { key: "code", label: "Order", mono: true },
    { key: "store", label: "Store" },
    { key: "status", label: "Status" },
    { key: "payment", label: "Payment", hideOnMobile: true },
    { key: "when", label: "Placed", hideOnMobile: true },
    { key: "total", label: "Total", align: "right" as const, mono: true },
    { key: "dispatch", label: "Rider", align: "right" as const },
    { key: "actions", label: "", align: "right" as const },
  ];

  function toRow(o: Row) {
    return {
      code: <span className="font-bold">{o.code}</span>,
      store: o.merchants?.name,
      status: <OrderStatusPill status={o.status} audience="ops" />,
      payment: `${o.payment_method.toUpperCase()} · ${o.payment_status}`,
      when: o.placed_at ? formatRelative(o.placed_at) : formatManilaDate(o.created_at),
      total: formatCentavos(o.total_centavos),
      dispatch:
        o.type === "delivery" && DISPATCHABLE.includes(o.status) ? (
          <AssignRider orderId={o.id} acceptedRiderName={acceptedRiderByOrder.get(o.id) ?? null} />
        ) : o.type === "pickup" ? (
          <span className="text-xs text-fg-muted">Pickup</span>
        ) : null,
      actions: DISPATCHABLE.includes(o.status) ? <CancelOrderAdmin orderId={o.id} /> : null,
    };
  }

  return (
    <>
      {/* Unfiltered - ops watches every order, so there is no narrower filter
          to apply the way a merchant or customer page has. */}
      <RealtimeRefresh table="orders" />
      <RealtimeRefresh table="delivery_assignments" />

      <ScreenHeader title="Orders" subtitle={`${live.length} live`} />

      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        <StatRow
          stats={[
            { label: "Live orders", value: String(live.length) },
            { label: "Delivered", value: String(deliveredCount ?? 0) },
            { label: "GMV delivered", value: formatCentavos(gmv) },
            {
              label: "Cancelled / failed",
              value: String(endedCount ?? 0),
              tone: (endedCount ?? 0) > 0 ? "warn" : "normal",
            },
          ]}
        />

        <section aria-labelledby="live-orders">
          <h2 id="live-orders" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Live orders
          </h2>
          <DataTable
            columns={columns}
            rows={live.map(toRow)}
            empty="No orders in flight"
            emptyDescription="Orders appear here the moment a customer places one."
          />
        </section>

        <section aria-labelledby="recent-orders">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="recent-orders" className="text-sm font-bold tracking-wide text-fg-muted uppercase">
              Recently completed
            </h2>
            <LinkButton href="/admin/orders/history" size="sm" variant="secondary">
              <History aria-hidden className="size-3.5" /> Full history
            </LinkButton>
          </div>
          <DataTable columns={columns} rows={past.map(toRow)} empty="No completed orders yet" />

          {past.length > 0 && pastTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-1">
              {pastPage > 1 ? (
                <Link
                  href={`/admin/orders?page=${pastPage - 1}`}
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
                  href={`/admin/orders?page=${pastPage + 1}`}
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
