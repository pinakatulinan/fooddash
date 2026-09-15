import type { Metadata } from "next";
import { CookingPot } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentMerchant } from "@/lib/merchant";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { OrderStatusPill } from "@/components/ui/status-pill";
import { OrderActions } from "@/components/merchant/order-actions";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { isLive } from "@/lib/domain/order-status";
import { formatCentavos, formatManilaTime, formatRelative } from "@/lib/format";
import type { OrderStatus } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Orders" };

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

export default async function MerchantOrdersPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

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
  const { data } = await supabase
    .from("orders")
    .select("id, code, status, type, total_centavos, placed_at, promised_at, delivery_address")
    .eq("merchant_id", merchant.id)
    .order("placed_at", { ascending: false })
    .limit(100);

  const orders = (data ?? []) as Row[];
  const live = orders.filter((o) => isLive(o.status));
  const done = orders.filter((o) => !isLive(o.status));

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

      <ScreenHeader
        title="Orders"
        subtitle={`${live.length} in the queue · ${orders.length} in the last 100`}
      />

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
          <h2 id="history" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Completed
          </h2>
          <DataTable columns={columns} rows={done.map(toRow)} empty="No completed orders yet" />
        </section>
      </div>
    </>
  );
}
