import Link from "next/link";
import { AlertTriangle, Bike, ShieldAlert, Store, Timer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card, CardBody } from "@/components/ui/card";
import { OrderStatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCentavos, formatRelative } from "@/lib/format";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import type { OrderStatus } from "@/lib/types/domain";

/**
 * Live ops.
 *
 * The board is organised around the only question that matters during service:
 * which orders are stuck. An order sitting in `placed` for eight minutes is a
 * merchant who has not looked at their tablet; one sitting in
 * `ready_for_pickup` is a rider shortage. Those are two different phone calls,
 * so they are two different rows.
 */

const STUCK_AFTER_MINUTES = 8;

/**
 * Kept out of the component body deliberately. Reading the clock during render
 * is impure, and the React compiler is right to complain about it even here
 * where the component only ever runs once per request.
 */
function stuckBefore(): string {
  return new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000).toISOString();
}

interface OpsOrder {
  id: string;
  code: string;
  status: OrderStatus;
  total_centavos: number;
  placed_at: string | null;
  merchants: { name: string } | null;
}

export default async function AdminLiveOpsPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const since = stuckBefore();

  const [{ data: live }, { data: stuck }, { count: onlineRiders }, { count: pendingStores }, { data: factors }] =
    await Promise.all([
      supabase
        .from("orders")
        .select("id, code, status, total_centavos, placed_at, merchants(name)")
        .in("status", ["placed", "accepted", "preparing", "ready_for_pickup", "picked_up", "arrived"])
        .order("placed_at", { ascending: true })
        .limit(50),
      supabase
        .from("orders")
        .select("id, code, status, total_centavos, placed_at, merchants(name)")
        .in("status", ["placed", "ready_for_pickup"])
        .lt("placed_at", since)
        .order("placed_at", { ascending: true }),
      supabase
        .from("riders")
        .select("id", { count: "exact", head: true })
        .eq("status", "online_idle"),
      supabase
        .from("merchants")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending_review"),
      supabase.auth.mfa.listFactors(),
    ]);

  const liveOrders = (live ?? []) as unknown as OpsOrder[];
  const stuckOrders = (stuck ?? []) as unknown as OpsOrder[];
  const hasMfa = (factors?.all ?? []).some((f) => f.status === "verified");

  return (
    <>
      <RealtimeRefresh table="orders" />
      <RealtimeRefresh table="riders" />
      <RealtimeRefresh table="merchants" />

      <ScreenHeader title="Live ops" subtitle="Everything happening right now" />

      <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6">
        {!hasMfa && (
          <Link
            href="/admin/settings"
            className="flex items-center gap-3 rounded-md border border-line bg-warning-tint px-4 py-3 text-sm font-medium text-warning hover:brightness-95"
          >
            <ShieldAlert aria-hidden className="size-4 shrink-0" />
            Two-factor authentication is off for your account. Set it up in Platform settings.
          </Link>
        )}

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric icon={<Timer className="size-4" />} label="Live orders" value={liveOrders.length} />
          <Metric
            icon={<AlertTriangle className="size-4" />}
            label={`Stuck > ${STUCK_AFTER_MINUTES}m`}
            value={stuckOrders.length}
            alarming={stuckOrders.length > 0}
          />
          <Metric icon={<Bike className="size-4" />} label="Riders idle" value={onlineRiders ?? 0} />
          <Metric icon={<Store className="size-4" />} label="Stores to review" value={pendingStores ?? 0} />
        </dl>

        {stuckOrders.length > 0 && (
          <OrderTable
            heading="Needs attention"
            orders={stuckOrders}
            tone="danger"
            empty="Nothing stuck."
          />
        )}

        <OrderTable
          heading="All live orders"
          orders={liveOrders}
          empty="No orders in flight. Quiet is good."
        />
      </div>
    </>
  );
}

function Metric({
  icon,
  label,
  value,
  alarming = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  alarming?: boolean;
}) {
  return (
    <Card className={alarming ? "border-danger" : undefined}>
      <CardBody className="p-4">
        <dt className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">
          <span aria-hidden>{icon}</span>
          {label}
        </dt>
        <dd
          className={`mt-1.5 text-2xl font-extrabold tracking-tight ${
            alarming ? "text-danger" : ""
          }`}
        >
          {value}
        </dd>
      </CardBody>
    </Card>
  );
}

function OrderTable({
  heading,
  orders,
  empty,
  tone,
}: {
  heading: string;
  orders: OpsOrder[];
  empty: string;
  tone?: "danger";
}) {
  return (
    <section aria-labelledby={`${heading.replace(/\s+/g, "-")}-heading`}>
      <h2
        id={`${heading.replace(/\s+/g, "-")}-heading`}
        className={`mb-3 text-sm font-bold tracking-wide uppercase ${
          tone === "danger" ? "text-danger" : "text-fg-muted"
        }`}
      >
        {heading}
      </h2>

      {orders.length === 0 ? (
        <Card>
          <EmptyState title={empty} />
        </Card>
      ) : (
        <Card>
          {/* Wide tables scroll inside their own container; the page body never
              scrolls sideways. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-140 text-sm">
              <thead className="border-b border-line bg-surface text-left">
                <tr className="text-xs font-bold tracking-wide text-fg-muted uppercase">
                  <th scope="col" className="px-4 py-3">Order</th>
                  <th scope="col" className="px-4 py-3">Store</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Placed</th>
                  <th scope="col" className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-mono font-bold">{order.code}</td>
                    <td className="max-w-48 truncate px-4 py-3">{order.merchants?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <OrderStatusPill status={order.status} audience="ops" />
                    </td>
                    <td className="px-4 py-3 text-fg-muted">{formatRelative(order.placed_at)}</td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {formatCentavos(order.total_centavos)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  );
}
