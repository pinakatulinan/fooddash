import { PauseCircle } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { OrderStatusPill, Pill } from "@/components/ui/status-pill";
import { OrderActions } from "@/components/merchant/order-actions";
import { CreateStoreForm } from "@/components/merchant/create-store-form";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { formatCentavos, formatManilaTime, formatRelative } from "@/lib/format";
import type { OrderStatus } from "@/lib/types/domain";

/**
 * The merchant's home screen: today's numbers, then the live queue.
 *
 * A Server Component read on every navigation, kept live between navigations
 * by <RealtimeRefresh>: a new order or a status change on an existing one
 * calls router.refresh() on its own, so the queue updates while the page
 * just sits there open during service. A sound on new orders would be a nice
 * addition on top of this, but is a separate, later piece.
 */

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

export default async function MerchantTodayPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const { profile } = await getCurrentUser();

  // RLS returns only stores this user belongs to, so no filter is needed here
  // beyond picking one. Multi-store owners get a switcher in the merchant slice.
  const { data: membership } = await supabase
    .from("merchant_members")
    .select("merchant_id, merchants(id, name, is_accepting_orders, status)")
    .limit(1)
    .maybeSingle();

  const merchant = membership?.merchants as
    | { id: string; name: string; is_accepting_orders: boolean; status: string }
    | undefined;

  if (!merchant) {
    return (
      <>
        <ScreenHeader title="Set up your store" subtitle={profile?.full_name ?? undefined} />
        <CreateStoreForm />
      </>
    );
  }

  const [{ data: stats }, { data: liveOrders }] = await Promise.all([
    supabase.rpc("merchant_stats", { p_merchant_id: merchant.id }),
    supabase
      .from("orders")
      .select("id, code, status, total_centavos, placed_at, promised_at, type, delivery_address")
      .eq("merchant_id", merchant.id)
      .in("status", ["placed", "accepted", "preparing", "ready_for_pickup", "picked_up", "arrived"])
      .order("placed_at", { ascending: true }),
  ]);

  const orders = (liveOrders ?? []) as LiveOrder[];
  const summary = (stats ?? {}) as Record<string, number>;

  return (
    <>
      <RealtimeRefresh table="orders" filter={`merchant_id=eq.${merchant.id}`} />

      <ScreenHeader
        title={merchant.name}
        subtitle="Last 7 days"
        actions={
          <Pill tone={merchant.is_accepting_orders ? "success" : "danger"}>
            {merchant.is_accepting_orders ? "Accepting orders" : "Paused"}
          </Pill>
        }
      />

      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6">
        {merchant.status !== "approved" && (
          <div className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-fg-muted">
            {merchant.status === "rejected"
              ? "Your store application was not approved. Check Settings for the reason, or reach out to ops."
              : "Your store is in review. Add your address and opening hours in Settings, and ops will reach out once it's ready to go live."}
          </div>
        )}

        <section aria-labelledby="week-heading">
          <h2 id="week-heading" className="sr-only">
            This week
          </h2>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Orders" value={String(summary.orders_count ?? 0)} />
            <Stat label="Gross sales" value={formatCentavos(summary.gross_centavos ?? 0)} />
            <Stat label="Your payout" value={formatCentavos(summary.payout_centavos ?? 0)} />
            <Stat
              label="Acceptance"
              value={`${Math.round((summary.acceptance_rate ?? 0) * 100)}%`}
              // The number that predicts complaints before customers write them.
              tone={(summary.acceptance_rate ?? 1) < 0.9 ? "warn" : "normal"}
            />
          </dl>
        </section>

        <section aria-labelledby="queue-heading">
          <h2 id="queue-heading" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Live queue ({orders.length})
          </h2>

          {orders.length === 0 ? (
            <Card>
              <EmptyState
                icon={<PauseCircle className="size-6" />}
                title="Nothing cooking"
                description="New orders appear here the moment a customer places one."
              />
            </Card>
          ) : (
            <ul className="space-y-2">
              {orders.map((order) => (
                <li key={order.id}>
                  <Card>
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
          )}
        </section>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "warn";
}) {
  return (
    <Card>
      <CardBody className="p-4">
        <dt className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{label}</dt>
        <dd
          className={`mt-1.5 text-xl font-extrabold tracking-tight ${
            tone === "warn" ? "text-warning" : ""
          }`}
        >
          {value}
        </dd>
      </CardBody>
    </Card>
  );
}
