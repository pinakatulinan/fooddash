import { notFound } from "next/navigation";
import Link from "next/link";
import { Bike, ChevronLeft, MessageCircle, Phone, Star } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { OrderStatusPill } from "@/components/ui/status-pill";
import { CancelOrder } from "@/components/customer/cancel-order";
import { RetryPaymentButton } from "@/components/customer/retry-payment-button";
import { OrderTrackingMap } from "@/components/customer/order-tracking-map";
import { OrderChat } from "@/components/order/order-chat";
import { RateOrderForm } from "@/components/customer/rate-order-form";
import { TicketThread } from "@/components/customer/ticket-thread";
import { ReportProblemPanel } from "@/components/customer/report-problem-panel";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { DELIVERY_TIMELINE, isLive, ORDER_STATUS, PICKUP_TIMELINE } from "@/lib/domain/order-status";
import { formatCentavos, formatManilaDate, formatManilaTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OrderTracking } from "@/lib/types/domain";

/** delivery_address is a free-form jsonb snapshot - only render the parts
    that were actually filled in, in the order a Filipino address reads. */
function formatAddress(address: Record<string, string> | null): string {
  if (!address) return "—";
  return [address.line1, address.landmark, address.barangay, address.city].filter(Boolean).join(", ");
}

/** Kept out of the component body deliberately - reading the clock during
    render is impure, and the React compiler is right to complain about it
    even here where the component only ever runs once per request. */
function minutesUntil(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

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
  const currentIndex = steps.indexOf(t.status);

  const { data: items } = await supabase
    .from("order_items")
    .select("id, name_snapshot, quantity, line_total_centavos, order_item_options(name_snapshot)")
    .eq("order_id", id);

  // order_tracking() only returns total_centavos (it is built for the
  // rider-facing tracking payload, not a receipt) - the fee breakdown is a
  // plain RLS-scoped read of the same row this page already knows it can see.
  const { data: amounts } = await supabase
    .from("orders")
    .select("subtotal_centavos, delivery_fee_centavos, service_fee_centavos, discount_centavos, tip_centavos")
    .eq("id", id)
    .single();

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

  const { data: messages } = isLive(t.status) && t.rider
    ? await supabase
        .from("order_messages")
        .select("id, sender_id, body, created_at")
        .eq("order_id", id)
        .order("created_at", { ascending: true })
    : { data: null };

  const showMap = isLive(t.status) && t.type === "delivery" && t.merchant.lat != null && t.merchant.lng != null;

  const etaMinutes = t.eta_minutes ?? (t.promised_at ? minutesUntil(t.promised_at) : null);

  return (
    <>
      <RealtimeRefresh table="orders" filter={`id=eq.${t.order_id}`} />
      <RealtimeRefresh table="order_events" filter={`order_id=eq.${t.order_id}`} />
      {/* Unfiltered would fire on every online rider's ~10-second location
          ping platform-wide - riders.current_location updates on every one
          (0008's record_rider_ping) - so this only ever watches the one
          rider actually assigned here, and only once there is one. */}
      {isLive(t.status) && t.rider && <RealtimeRefresh table="riders" filter={`id=eq.${t.rider.rider_id}`} />}
      {(tickets ?? []).map((ticket) => (
        <RealtimeRefresh key={ticket.id} table="support_messages" filter={`ticket_id=eq.${ticket.id}`} />
      ))}
      <RealtimeRefresh table="support_tickets" filter={`order_id=eq.${t.order_id}`} />

      {showMap ? (
        <div className="relative h-107.5 overflow-hidden bg-hero-brown">
          <OrderTrackingMap
            merchant={{ lat: t.merchant.lat!, lng: t.merchant.lng!, name: t.merchant.name }}
            dropoff={t.dropoff.lat != null && t.dropoff.lng != null ? { lat: t.dropoff.lat, lng: t.dropoff.lng } : null}
            rider={
              t.rider && t.rider.lat != null && t.rider.lng != null
                ? { lat: t.rider.lat, lng: t.rider.lng, first_name: t.rider.first_name }
                : null
            }
          />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-5 py-2.5">
            <Link
              href="/orders"
              aria-label="Back to orders"
              className="grid size-10.5 place-items-center rounded-full bg-card text-fg shadow-card"
            >
              <ChevronLeft aria-hidden className="size-5" />
            </Link>
            <span className="flex h-11 items-center rounded-[14px] bg-card px-3.5 font-mono text-[13px] font-semibold shadow-card">
              {t.code}
            </span>
          </div>
        </div>
      ) : (
        <ScreenHeader
          title={t.merchant.name}
          subtitle={ORDER_STATUS[t.status].customer}
          backHref="/orders"
          actions={<OrderStatusPill status={t.status} audience="customer" />}
        />
      )}

      <div
        className={cn(
          "space-y-5 px-5 pb-6",
          showMap ? "-mt-8 rounded-t-4xl bg-card pt-3 shadow-[0_-10px_30px_rgb(122_58_31/0.12)]" : "pt-4",
        )}
      >
        {showMap && <div aria-hidden className="mx-auto mb-1 h-1 w-10 rounded-pill bg-line-warm" />}

        {showMap && (
          <div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold tracking-wide text-primary uppercase">
                  {t.type === "pickup" ? "Ready in" : "Arriving in"}
                </p>
                <p className="text-[34px] leading-none font-extrabold tabular-nums">
                  {etaMinutes != null ? `${etaMinutes} min` : "—"}
                </p>
              </div>
              <OrderStatusPill status={t.status} audience="customer" />
            </div>
            <p className="mt-1.5 text-sm text-fg-muted">
              {ORDER_STATUS[t.status].customer}
              {t.promised_at && ` · due ${formatManilaTime(t.promised_at)}`}
            </p>

            <div className="mt-4 flex gap-1">
              {steps.map((step, i) => (
                <span
                  key={step}
                  aria-hidden
                  className={cn(
                    "h-1.5 flex-1 rounded-[3px]",
                    reached.has(step) ? "bg-mint-mark" : i === currentIndex ? "bg-primary" : "bg-line-warm",
                  )}
                />
              ))}
            </div>
            <div className="mt-1.5 flex gap-1 text-center">
              {steps.map((step) => (
                <span
                  key={step}
                  className={cn(
                    "flex-1 truncate text-[11px]",
                    t.status === step ? "font-semibold text-fg" : reached.has(step) ? "text-fg" : "text-fg-muted",
                  )}
                >
                  {ORDER_STATUS[step].customer}
                </span>
              ))}
            </div>
          </div>
        )}

        {endReason && (
          <div className="rounded-[20px] border-2 border-danger bg-card p-4">
            <p className="text-xs font-semibold tracking-wide text-danger uppercase">
              {t.status === "cancelled" ? "Cancellation reason" : "What went wrong"}
            </p>
            <p className="mt-1 text-sm">{endReason}</p>
          </div>
        )}

        {isLive(t.status) && t.rider && (
          <div className="flex items-center gap-3 rounded-[20px] bg-cream p-3.5">
            <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-pill bg-mint-tint text-accent-fg">
              <Bike className="size-5.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold">{t.rider.first_name}</p>
              <p className="text-xs text-fg-muted">
                {t.rider.vehicle.replace("_", " ")}
                {t.rider.plate_number && ` · ${t.rider.plate_number}`}
              </p>
            </div>
            {user && (
              <a
                href="#chat"
                aria-label={`Message ${t.rider.first_name}`}
                className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-card text-fg shadow-card"
              >
                <MessageCircle aria-hidden className="size-4.5" />
              </a>
            )}
            {t.rider.phone && (
              <a
                href={`tel:${t.rider.phone}`}
                aria-label={`Call ${t.rider.first_name}`}
                className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-primary text-primary-fg"
              >
                <Phone aria-hidden className="size-4.5" />
              </a>
            )}
          </div>
        )}

        <div id="chat">
          {isLive(t.status) && user && t.rider && (
            <OrderChat
              orderId={t.order_id}
              currentUserId={user.id}
              messages={messages ?? []}
              canSend={!["delivered", "cancelled", "failed"].includes(t.status)}
            />
          )}
        </div>

        {!showMap && (
          <section aria-labelledby="progress">
            <h2 id="progress" className="mb-3 text-[15px] font-bold">
              Progress
            </h2>
            <div className="rounded-[20px] bg-card shadow-card">
              <ol className="divide-y divide-line-warm">
                {steps.map((step) => {
                  const done = reached.has(step);
                  const current = t.status === step;
                  return (
                    <li key={step} className="flex items-center gap-3 px-4 py-3">
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 shrink-0 rounded-pill",
                          done ? "bg-mint-mark" : "bg-line-warm",
                        )}
                      />
                      <span className={cn("flex-1 text-sm", current ? "font-bold" : done ? "" : "text-fg-muted")}>
                        {ORDER_STATUS[step].customer}
                      </span>
                      <span className="shrink-0 text-xs text-fg-muted tabular-nums">
                        {done ? formatManilaTime(stampFor(step)) : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>
        )}

        {/* Store row - always visible; a native disclosure keeps the order
            details/items/totals out of the way until asked for, without
            needing client JS for something this simple. */}
        <details className="group rounded-[20px] bg-card shadow-card open:pb-1">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-3.5">
            {t.merchant.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.merchant.logo_url} alt="" className="size-10 shrink-0 rounded-pill object-cover" />
            ) : (
              <div className="size-10 shrink-0 rounded-pill bg-coral-tint" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{t.merchant.name}</p>
              <p className="truncate text-xs text-fg-muted">
                {(items ?? []).length} items · {formatCentavos(t.total_centavos)} ·{" "}
                {t.payment_method === "cod" ? "Cash" : t.payment_method.toUpperCase()}
              </p>
            </div>
            <span className="shrink-0 text-[13px] font-semibold text-primary group-open:hidden">Details</span>
            <span className="hidden shrink-0 text-[13px] font-semibold text-primary group-open:inline">Hide</span>
          </summary>

          <div className="space-y-3 px-3.5 pt-1 pb-3">
            <div className="rounded-2xl bg-cream">
              <dl className="divide-y divide-line-warm">
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="text-xs text-fg-muted">Order number</dt>
                  <dd className="font-mono text-xs font-semibold">{t.code}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="text-xs text-fg-muted">Ordered on</dt>
                  <dd className="text-right text-xs font-semibold">
                    {t.placed_at ? `${formatManilaDate(t.placed_at)} · ${formatManilaTime(t.placed_at)}` : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="shrink-0 text-xs text-fg-muted">
                    {t.type === "pickup" ? "Pickup at" : "Delivered to"}
                  </dt>
                  <dd className="text-right text-xs font-semibold">
                    {t.type === "pickup" ? t.merchant.name : formatAddress(t.dropoff.address)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="text-xs text-fg-muted">Payment</dt>
                  <dd className="text-right text-xs font-semibold">
                    {t.payment_method === "cod" ? "Cash on delivery" : t.payment_method.toUpperCase()} ·{" "}
                    {t.payment_status}
                  </dd>
                </div>
              </dl>
            </div>

            <ul className="divide-y divide-line-warm rounded-2xl bg-cream">
              {(items ?? []).map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-3.5 py-2.5">
                  <span className="text-xs font-bold tabular-nums">{item.quantity}×</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">{item.name_snapshot}</p>
                    {item.order_item_options.length > 0 && (
                      <p className="text-[11px] text-fg-muted">
                        {item.order_item_options.map((o) => o.name_snapshot).join(", ")}
                      </p>
                    )}
                  </div>
                  <span className="text-xs font-semibold tabular-nums">
                    {formatCentavos(item.line_total_centavos)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="divide-y divide-dashed divide-line-warm rounded-2xl bg-cream px-3.5">
              <div className="flex items-center justify-between py-2">
                <dt className="text-xs text-fg-muted">Subtotal</dt>
                <dd className="text-xs tabular-nums">{formatCentavos(amounts?.subtotal_centavos ?? 0)}</dd>
              </div>
              {t.type === "delivery" && (
                <div className="flex items-center justify-between py-2">
                  <dt className="text-xs text-fg-muted">Delivery fee</dt>
                  <dd className="text-xs tabular-nums">{formatCentavos(amounts?.delivery_fee_centavos ?? 0)}</dd>
                </div>
              )}
              <div className="flex items-center justify-between py-2">
                <dt className="text-xs text-fg-muted">Service fee</dt>
                <dd className="text-xs tabular-nums">{formatCentavos(amounts?.service_fee_centavos ?? 0)}</dd>
              </div>
              {(amounts?.discount_centavos ?? 0) > 0 && (
                <div className="flex items-center justify-between py-2">
                  <dt className="text-xs text-fg-muted">Discount</dt>
                  <dd className="text-xs tabular-nums text-accent-fg">−{formatCentavos(amounts!.discount_centavos)}</dd>
                </div>
              )}
              {(amounts?.tip_centavos ?? 0) > 0 && (
                <div className="flex items-center justify-between py-2">
                  <dt className="text-xs text-fg-muted">Rider tip</dt>
                  <dd className="text-xs tabular-nums">{formatCentavos(amounts!.tip_centavos)}</dd>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-solid border-line py-2.5">
                <dt className="text-sm font-bold">Total</dt>
                <dd className="text-base font-extrabold tabular-nums">{formatCentavos(t.total_centavos)}</dd>
              </div>
            </dl>
          </div>
        </details>

        {t.status === "delivered" &&
          (existingReview ? (
            <div className="rounded-[20px] bg-cream p-4">
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
            <h2 id="support" className="mb-3 text-[15px] font-bold">
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
            className="flex items-center justify-center gap-2 rounded-[18px] bg-card px-4 py-3 font-semibold shadow-card"
          >
            <Phone aria-hidden className="size-4" />
            Call {t.merchant.name}
          </a>
        )}
      </div>
    </>
  );
}
