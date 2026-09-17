import type { Metadata } from "next";
import { MapPin, Navigation, Phone, Store } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { OrderStatusPill } from "@/components/ui/status-pill";
import { DeliveryActions } from "@/components/rider/delivery-actions";
import { OrderTrackingMap } from "@/components/customer/order-tracking-map";
import { OrderChat } from "@/components/order/order-chat";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { ORDER_STATUS } from "@/lib/domain/order-status";
import { formatCentavos } from "@/lib/format";
import type { OrderStatus, OrderTracking } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Active delivery" };

export default async function RiderActivePage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();

  // RLS limits assignments to this rider, so "the accepted one" is unambiguous.
  const { data } = await supabase
    .from("delivery_assignments")
    .select(
      `id, status, payout_centavos,
       orders(id, code, status, type, total_centavos, payment_method, delivery_address,
              merchants(name, phone, line1, barangay, city))`,
    )
    .eq("status", "accepted")
    .order("offered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const order = data?.orders as unknown as
    | {
        id: string;
        code: string;
        status: OrderStatus;
        type: string;
        total_centavos: number;
        payment_method: string;
        delivery_address: Record<string, string> | null;
        merchants: { name: string; phone: string | null; line1: string | null; barangay: string | null; city: string | null } | null;
      }
    | undefined;

  if (!order) {
    return (
      <>
        {/* Watches for a new accepted assignment - e.g. this same tab, or the
            rider's own action elsewhere, flips one to 'accepted' - so this
            empty state does not require a manual reload to move past. */}
        <RealtimeRefresh table="delivery_assignments" filter="status=eq.accepted" />
        <ScreenHeader title="Active delivery" />
        <div className="px-4 py-5">
          <Card>
            <EmptyState
              icon={<Navigation className="size-6" />}
              title="No active delivery"
              description="Accept an offer and it will appear here with pickup and drop-off details."
              action={<LinkButton href="/rider">See offers</LinkButton>}
            />
          </Card>
        </div>
      </>
    );
  }

  const drop = order.delivery_address ?? {};

  // Same RPC the customer's tracking page uses - it already returns store
  // and drop-off coordinates plus this rider's own live position (v_rider
  // resolves to whoever is asking), so there is nothing new to expose here.
  const { data: tracking } = await supabase.rpc("order_tracking", { p_order_id: order.id });
  const t = tracking as OrderTracking | null;

  const { data: messages } = await supabase
    .from("order_messages")
    .select("id, sender_id, body, created_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });

  const { user } = await getCurrentUser();

  return (
    <>
      <RealtimeRefresh table="orders" filter={`id=eq.${order.id}`} />
      <RealtimeRefresh table="delivery_assignments" filter={`order_id=eq.${order.id}`} />

      <ScreenHeader
        title={order.code}
        subtitle={ORDER_STATUS[order.status].rider}
        backHref="/rider"
        actions={<OrderStatusPill status={order.status} audience="rider" />}
      />

      <div className="space-y-4 px-4 py-5">
        {order.payment_method === "cod" && (
          <div className="rounded-md border border-primary bg-coral-tint px-4 py-3">
            <p className="text-sm font-bold text-header-fg">
              Collect {formatCentavos(order.total_centavos)} in cash
            </p>
          </div>
        )}

        {t?.merchant.lat != null && t.merchant.lng != null && (
          <OrderTrackingMap
            merchant={{ lat: t.merchant.lat, lng: t.merchant.lng, name: t.merchant.name }}
            dropoff={t.dropoff.lat != null && t.dropoff.lng != null ? { lat: t.dropoff.lat, lng: t.dropoff.lng } : null}
            rider={
              t.rider && t.rider.lat != null && t.rider.lng != null
                ? { lat: t.rider.lat, lng: t.rider.lng, first_name: t.rider.first_name }
                : null
            }
            // Before pickup, the direction that matters is to the store;
            // once the food is on the bike, it flips to the drop-off.
            highlightTarget={order.status === "picked_up" || order.status === "arrived" ? "dropoff" : "merchant"}
          />
        )}

        <Card>
          <div className="p-4">
            <p className="flex items-center gap-2 text-xs font-bold tracking-wide text-fg-muted uppercase">
              <Store aria-hidden className="size-3.5" /> Pick up
            </p>
            <p className="mt-1.5 font-bold">{order.merchants?.name}</p>
            <p className="text-sm text-fg-muted">
              {[order.merchants?.line1, order.merchants?.barangay, order.merchants?.city]
                .filter(Boolean)
                .join(", ")}
            </p>
            {order.merchants?.phone && (
              <a
                href={`tel:${order.merchants.phone}`}
                className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-primary"
              >
                <Phone aria-hidden className="size-4" />
                Call the store
              </a>
            )}
          </div>
        </Card>

        <Card>
          <div className="p-4">
            <p className="flex items-center gap-2 text-xs font-bold tracking-wide text-fg-muted uppercase">
              <MapPin aria-hidden className="size-3.5" /> Drop off
            </p>
            <p className="mt-1.5 font-bold">{drop.line1 ?? "—"}</p>
            <p className="text-sm text-fg-muted">
              {[drop.barangay, drop.city, drop.province].filter(Boolean).join(", ")}
            </p>
            {/* The landmark is how riders actually find the door. */}
            {drop.landmark && <p className="mt-2 text-sm font-medium">“{drop.landmark}”</p>}
            {drop.delivery_notes && (
              <p className="mt-1 text-sm text-fg-muted">{drop.delivery_notes}</p>
            )}
            {drop.recipient_phone && (
              <a
                href={`tel:${drop.recipient_phone}`}
                className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-primary"
              >
                <Phone aria-hidden className="size-4" />
                Call {drop.recipient_name || "the customer"}
              </a>
            )}
          </div>
        </Card>

        {user && (
          <OrderChat orderId={order.id} currentUserId={user.id} messages={messages ?? []} canSend />
        )}

        <DeliveryActions orderId={order.id} status={order.status} />
      </div>
    </>
  );
}
