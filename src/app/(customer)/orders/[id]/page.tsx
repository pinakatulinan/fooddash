import { notFound } from "next/navigation";
import { Bike, Check, Phone, Star } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card } from "@/components/ui/card";
import { OrderStatusPill } from "@/components/ui/status-pill";
import { CancelOrder } from "@/components/customer/cancel-order";
import { RetryPaymentButton } from "@/components/customer/retry-payment-button";
import { OrderTrackingMap } from "@/components/customer/order-tracking-map";
import { OrderChat } from "@/components/order/order-chat";
import { RateOrderForm } from "@/components/customer/rate-order-form";
import { TicketThread } from "@/components/customer/ticket-thread";
import { ReportProblemPanel } from "@/components/customer/report-problem-panel";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { DELIVERY_TIMELINE, ORDER_STATUS, PICKUP_TIMELINE } from "@/lib/domain/order-status";
import { formatCentavos, formatManilaTime } from "@/lib/format";
import type { OrderTracking } from "@/lib/types/domain";

/**
 * Order tracking.
 *
 * The whole payload comes from one `order_tracking` call, which is also what
 * decides how much of the rider is revealed: first name, vehicle, plate and
 * live position - never the full profile.
 */
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("order_tracking", { p_order_id: id });
  if (error || !data) notFound();

  const t = data as OrderTracking;
  const steps = t.type === "pickup" ? PICKUP_TIMELINE : DELIVERY_TIMELINE;
  const reached = new Set(t.timeline.map((e) => e.status));
  const stampFor = (s: string) => t.timeline.find((e) => e.status === s)?.at;

  const { data: items } = await supabase
    .from("order_items")
    .select("id, name_snapshot, quantity, line_total_centavos, order_item_options(name_snapshot)")
    .eq("order_id", id);

  const { user } = await getCurrentUser();
  const { data: existingReview } =
    t.status === "delivered"
      ? await supabase
          .from("reviews")
          .select("merchant_rating, rider_rating, comment")
          .eq("order_id", id)
          .maybeSingle()
      : { data: null };

  const endReason =
    (t.status === "cancelled" || t.status === "failed")
      ? t.timeline.find((e) => e.status === t.status)?.note
      : null;

  const { data: tickets } = await supabase
    .from("support_tickets")
    .select(
      "id, category, subject, body, status, resolution, created_at, messages:support_messages(id, author_id, body, created_at)",
    )
    .eq("order_id", id)
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "messages", ascending: true });

  const { data: messages } = t.rider
    ? await supabase
        .from("order_messages")
        .select("id, sender_id, body, created_at")
        .eq("order_id", id)
        .order("created_at", { ascending: true })
    : { data: null };

  return (
    <>
      <RealtimeRefresh table="orders" filter={`id=eq.${t.order_id}`} />
      <RealtimeRefresh table="order_events" filter={`order_id=eq.${t.order_id}`} />
      {/* Unfiltered would fire on every online rider's ~10-second location
          ping platform-wide - riders.current_location updates on every one
          (0008's record_rider_ping) - so this only ever watches the one
          rider actually assigned here, and only once there is one. */}
      {t.rider && <RealtimeRefresh table="riders" filter={`id=eq.${t.rider.rider_id}`} />}
      {(tickets ?? []).map((ticket) => (
        <RealtimeRefresh key={ticket.id} table="support_messages" filter={`ticket_id=eq.${ticket.id}`} />
      ))}
      <RealtimeRefresh table="support_tickets" filter={`order_id=eq.${t.order_id}`} />

      <ScreenHeader
        title={t.merchant.name}
        subtitle={ORDER_STATUS[t.status].customer}
        backHref="/orders"
        actions={<OrderStatusPill status={t.status} audience="customer" />}
      />

      <div className="space-y-6 px-4 py-6">
        <p className="font-mono text-sm text-fg-muted">
          {t.code}
          {t.promised_at && ` · due ${formatManilaTime(t.promised_at)}`}
        </p>

        {endReason && (
          <Card className="border-danger">
            <div className="p-4">
              <p className="text-xs font-semibold tracking-wide text-danger uppercase">
                {t.status === "cancelled" ? "Cancellation reason" : "What went wrong"}
              </p>
              <p className="mt-1 text-sm">{endReason}</p>
            </div>
          </Card>
        )}

        {t.type === "delivery" && t.merchant.lat != null && t.merchant.lng != null && (
          <OrderTrackingMap
            merchant={{ lat: t.merchant.lat, lng: t.merchant.lng, name: t.merchant.name }}
            dropoff={t.dropoff.lat != null && t.dropoff.lng != null ? { lat: t.dropoff.lat, lng: t.dropoff.lng } : null}
            rider={
              t.rider && t.rider.lat != null && t.rider.lng != null
                ? { lat: t.rider.lat, lng: t.rider.lng, first_name: t.rider.first_name }
                : null
            }
          />
        )}

        {t.rider && (
          <Card>
            <div className="flex items-center gap-4 p-4">
              <span aria-hidden className="grid size-10 place-items-center rounded-pill bg-accent text-accent-fg">
                <Bike className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold">{t.rider.first_name}</p>
                <p className="text-sm text-fg-muted">
                  {t.rider.vehicle.replace("_", " ")}
                  {t.rider.plate_number && ` · ${t.rider.plate_number}`}
                </p>
              </div>
              {t.rider.phone && (
                <a
                  href={`tel:${t.rider.phone}`}
                  aria-label={`Call ${t.rider.first_name}`}
                  className="grid size-10 shrink-0 place-items-center rounded-pill bg-header text-header-fg"
                >
                  <Phone aria-hidden className="size-4" />
                </a>
              )}
            </div>
          </Card>
        )}

        {user && t.rider && (
          <OrderChat
            orderId={t.order_id}
            currentUserId={user.id}
            messages={messages ?? []}
            canSend={!["delivered", "cancelled", "failed"].includes(t.status)}
          />
        )}

        <section aria-labelledby="progress">
          <h2 id="progress" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Progress
          </h2>
          <Card>
            <ol className="divide-y divide-line">
              {steps.map((step) => {
                const done = reached.has(step);
                const current = t.status === step;
                return (
                  <li key={step} className="flex items-center gap-3 px-4 py-3">
                    <span
                      aria-hidden
                      className={`grid size-6 shrink-0 place-items-center rounded-pill ${
                        done ? "bg-accent text-accent-fg" : "bg-surface-raised text-fg-muted"
                      }`}
                    >
                      {done ? <Check className="size-3.5" /> : <span className="size-1.5 rounded-pill bg-current" />}
                    </span>
                    <span className={`flex-1 text-sm ${current ? "font-bold" : done ? "" : "text-fg-muted"}`}>
                      {ORDER_STATUS[step].customer}
                    </span>
                    <span className="shrink-0 text-xs text-fg-muted tabular-nums">
                      {done ? formatManilaTime(stampFor(step)) : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>
        </section>

        <section aria-labelledby="items">
          <h2 id="items" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Your order
          </h2>
          <Card>
            <ul className="divide-y divide-line">
              {(items ?? []).map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="text-sm font-bold tabular-nums">{item.quantity}×</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{item.name_snapshot}</p>
                    {item.order_item_options.length > 0 && (
                      <p className="text-xs text-fg-muted">
                        {item.order_item_options.map((o) => o.name_snapshot).join(", ")}
                      </p>
                    )}
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatCentavos(item.line_total_centavos)}
                  </span>
                </li>
              ))}
              <li className="flex items-center justify-between px-4 py-3">
                <span className="font-bold">Total</span>
                <span className="text-lg font-extrabold tabular-nums">
                  {formatCentavos(t.total_centavos)}
                </span>
              </li>
            </ul>
          </Card>
          <p className="mt-2 text-xs text-fg-muted">
            Paid by {t.payment_method === "cod" ? "cash on delivery" : t.payment_method.toUpperCase()} ·{" "}
            {t.payment_status}
          </p>
        </section>

        {t.status === "delivered" &&
          (existingReview ? (
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Star aria-hidden className="size-4 fill-current text-primary" />
                You rated the store {existingReview.merchant_rating}/5
                {existingReview.rider_rating != null && ` · your rider ${existingReview.rider_rating}/5`}
              </p>
              {existingReview.comment && (
                <p className="mt-1.5 text-sm text-fg-muted">&ldquo;{existingReview.comment}&rdquo;</p>
              )}
            </div>
          ) : (
            user && <RateOrderForm orderId={t.order_id} customerId={user.id} hasRider={t.rider !== null} />
          ))}

        {user && (tickets ?? []).length > 0 && (
          <section aria-labelledby="support">
            <h2 id="support" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
              Reported issues
            </h2>
            <div className="space-y-3">
              {tickets!.map((ticket) => (
                <TicketThread key={ticket.id} ticket={ticket} customerId={user.id} />
              ))}
            </div>
          </section>
        )}

        {user && <ReportProblemPanel orderId={t.order_id} customerId={user.id} />}

        {t.status === "pending_payment" && t.payment_status === "pending" && (
          <RetryPaymentButton orderId={t.order_id} />
        )}

        <CancelOrder orderId={t.order_id} status={t.status} />

        {t.merchant.phone && (
          <a
            href={`tel:${t.merchant.phone}`}
            className="flex items-center justify-center gap-2 rounded-md border border-line bg-card px-4 py-3 font-semibold hover:bg-surface-raised"
          >
            <Phone aria-hidden className="size-4" />
            Call {t.merchant.name}
          </a>
        )}
      </div>
    </>
  );
}
