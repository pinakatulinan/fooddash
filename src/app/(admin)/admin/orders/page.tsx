import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DataTable, StatRow } from "@/components/ui/data-table";
import { OrderStatusPill } from "@/components/ui/status-pill";
import { AssignRider } from "@/components/admin/assign-rider";
import { CancelOrderAdmin } from "@/components/admin/cancel-order";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { formatCentavos, formatManilaDate, formatRelative } from "@/lib/format";
import type { OrderStatus } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Orders" };

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

// Manual dispatch only makes sense while an order is somewhere between
// "the kitchen has it" and "a rider is already carrying it".
const DISPATCHABLE: OrderStatus[] = ["placed", "accepted", "preparing", "ready_for_pickup"];

export default async function AdminOrdersPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const [{ data }, { data: assignmentRows }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, code, status, type, payment_method, payment_status, total_centavos, created_at, placed_at, merchants(name)",
      )
      .order("created_at", { ascending: false })
      .limit(200),
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
  ]);

  const orders = (data ?? []) as unknown as Row[];

  const acceptedRiderByOrder = new Map(
    (assignmentRows ?? []).map((a) => [
      a.order_id,
      (a.riders as unknown as { profiles: { full_name: string | null } })?.profiles
        ?.full_name ?? "Unnamed rider",
    ]),
  );
  const delivered = orders.filter((o) => o.status === "delivered");
  const gmv = delivered.reduce((s, o) => s + o.total_centavos, 0);
  const cancelled = orders.filter((o) => o.status === "cancelled" || o.status === "failed").length;

  return (
    <>
      {/* Unfiltered - ops watches every order, so there is no narrower filter
          to apply the way a merchant or customer page has. */}
      <RealtimeRefresh table="orders" />
      <RealtimeRefresh table="delivery_assignments" />

      <ScreenHeader title="Orders" subtitle="Most recent 200" />

      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        <StatRow
          stats={[
            { label: "Orders", value: String(orders.length) },
            { label: "Delivered", value: String(delivered.length) },
            { label: "GMV delivered", value: formatCentavos(gmv) },
            {
              label: "Cancelled / failed",
              value: String(cancelled),
              tone: cancelled > 0 ? "warn" : "normal",
            },
          ]}
        />

        <DataTable
          columns={[
            { key: "code", label: "Order", mono: true },
            { key: "store", label: "Store" },
            { key: "status", label: "Status" },
            { key: "payment", label: "Payment", hideOnMobile: true },
            { key: "when", label: "Placed", hideOnMobile: true },
            { key: "total", label: "Total", align: "right", mono: true },
            { key: "dispatch", label: "Rider", align: "right" },
            { key: "actions", label: "", align: "right" },
          ]}
          rows={orders.map((o) => ({
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
          }))}
          empty="No orders yet"
          emptyDescription="Orders appear here the moment a customer places one."
        />
      </div>
    </>
  );
}
