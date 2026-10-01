import { Minus, PauseCircle, TrendingDown, TrendingUp, UtensilsCrossed } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NotificationBell } from "@/components/layout/notification-bell";
import { CreateStoreForm } from "@/components/merchant/create-store-form";
import { PauseStoreControl } from "@/components/merchant/pause-store-control";
import { LiveQueueList } from "@/components/merchant/live-queue-list";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { formatCentavos } from "@/lib/format";
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
    .select(
      "merchant_id, merchants(id, name, logo_url, is_accepting_orders, paused_until, pause_reason, status)",
    )
    .limit(1)
    .maybeSingle();

  const merchant = membership?.merchants as
    | {
        id: string;
        name: string;
        logo_url: string | null;
        is_accepting_orders: boolean;
        paused_until: string | null;
        pause_reason: string | null;
        status: string;
      }
    | undefined;

  if (!merchant) {
    return (
      <>
        <ScreenHeader title="Set up your store" subtitle={profile?.full_name ?? undefined} />
        <CreateStoreForm />
      </>
    );
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [{ data: stats }, { data: prevStats }, { data: liveOrders }] = await Promise.all([
    supabase.rpc("merchant_stats", { p_merchant_id: merchant.id }),
    // The week before that, same RPC - the only way to tell "quiet week" from
    // "the number always looks like this". Not a new endpoint: merchant_stats
    // already takes an arbitrary window, this just asks for a second one.
    supabase.rpc("merchant_stats", {
      p_merchant_id: merchant.id,
      p_from: twoWeeksAgo.toISOString(),
      p_to: weekAgo.toISOString(),
    }),
    supabase
      .from("orders")
      .select("id, code, status, total_centavos, placed_at, promised_at, type, delivery_address")
      .eq("merchant_id", merchant.id)
      .in("status", ["placed", "accepted", "preparing", "ready_for_pickup", "picked_up", "arrived"])
      .order("placed_at", { ascending: true }),
  ]);

  const orders = (liveOrders ?? []) as LiveOrder[];
  const summary = (stats ?? {}) as Record<string, number>;
  const previous = (prevStats ?? {}) as Record<string, number>;

  return (
    <>
      <RealtimeRefresh table="orders" filter={`merchant_id=eq.${merchant.id}`} />

      <div className="flex items-center gap-3 px-5 pt-3.5">
        {merchant.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={merchant.logo_url} alt="" className="size-12 shrink-0 rounded-pill border border-line object-cover" />
        ) : (
          <div className="grid size-12 shrink-0 place-items-center rounded-pill bg-coral-tint">
            <UtensilsCrossed aria-hidden className="size-5 text-primary" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[19px] font-extrabold tracking-[-0.01em]">{merchant.name}</h1>
          <p className="text-xs text-fg-muted">Last 7 days</p>
        </div>
        <NotificationBell surface="merchant" />
      </div>

      <div className="mx-auto w-full max-w-5xl space-y-5 px-5 py-5">
        {merchant.status !== "approved" && (
          <div className="rounded-2xl bg-cream px-4 py-3 text-sm text-fg-muted">
            {merchant.status === "rejected"
              ? "Your store application was not approved. Check Settings for the reason, or reach out to ops."
              : "Your store is in review. Add your address and opening hours in Settings, and ops will reach out once it's ready to go live."}
          </div>
        )}

        <PauseStoreControl
          merchantId={merchant.id}
          isAcceptingOrders={merchant.is_accepting_orders}
          pausedUntil={merchant.paused_until}
          pauseReason={merchant.pause_reason}
        />

        <section aria-labelledby="week-heading">
          <h2 id="week-heading" className="sr-only">
            This week
          </h2>
          <dl className="grid grid-cols-2 gap-2.5">
            <Stat
              label="Orders"
              value={String(summary.orders_count ?? 0)}
              trend={trendPct(summary.orders_count, previous.orders_count)}
            />
            <Stat
              label="Gross sales"
              value={formatCentavos(summary.gross_centavos ?? 0)}
              trend={trendPct(summary.gross_centavos, previous.gross_centavos)}
            />
            <Stat
              label="Your payout"
              value={formatCentavos(summary.payout_centavos ?? 0)}
              trend={trendPct(summary.payout_centavos, previous.payout_centavos)}
            />
            <Stat
              label="Acceptance"
              value={`${Math.round((summary.acceptance_rate ?? 0) * 100)}%`}
              tone={(summary.acceptance_rate ?? 1) < 0.9 ? "warn" : "normal"}
              trend={trendPoints(summary.acceptance_rate, previous.acceptance_rate)}
            />
          </dl>
        </section>

        <section aria-labelledby="queue-heading">
          <h2 id="queue-heading" className="mb-3 text-[16px] font-bold">
            Live queue <span className="text-primary">{orders.length}</span>
          </h2>

          {orders.length === 0 ? (
            <div className="rounded-[20px] bg-card shadow-card">
              <EmptyState
                icon={<PauseCircle className="size-6" />}
                title="Nothing cooking"
                description="New orders appear here the moment a customer places one."
              />
            </div>
          ) : (
            <LiveQueueList orders={orders} />
          )}
        </section>
      </div>
    </>
  );
}

interface Trend {
  dir: "up" | "down" | "flat";
  label: string;
}

const TREND_ICON: Record<Trend["dir"], typeof TrendingUp> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

/** Green-for-up is a customer-app convention that doesn't hold here - a
    merchant only cares whether a number moved, not whether "up" is good
    (more cancellations going up is bad). Direction is neutral grey; the
    number itself already carries the judgement (e.g. acceptance in warning
    colour below 90%). */
const TREND_CLASSES = "text-fg-muted";

function Stat({
  label,
  value,
  tone = "normal",
  trend,
}: {
  label: string;
  value: string;
  tone?: "normal" | "warn";
  trend?: Trend | null;
}) {
  const TrendIcon = trend ? TREND_ICON[trend.dir] : null;

  return (
    <div className="rounded-[18px] bg-card px-3.5 py-3 shadow-card">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={`mt-1.5 text-[22px] font-extrabold tracking-tight ${tone === "warn" ? "text-warning" : ""}`}>
        {value}
      </dd>
      {trend && TrendIcon && (
        <p className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${TREND_CLASSES}`}>
          <TrendIcon aria-hidden className="size-3" />
          {trend.label} vs last week
        </p>
      )}
    </div>
  );
}

/** Relative change vs. the prior 7-day window. `previous` at 0 can't give a
    percentage, so it's called out as "New" rather than shown as +Infinity%. */
function trendPct(current: number | undefined, previous: number | undefined): Trend | null {
  const c = current ?? 0;
  const p = previous ?? 0;
  if (p === 0) return c === 0 ? null : { dir: "up", label: "New" };
  const pct = ((c - p) / p) * 100;
  if (Math.abs(pct) < 1) return { dir: "flat", label: "steady" };
  return { dir: pct > 0 ? "up" : "down", label: `${pct > 0 ? "+" : ""}${Math.round(pct)}%` };
}

/** For a rate like acceptance, a percentage-point delta ("+3pts") reads
    better than a relative percentage of an already-small number. */
function trendPoints(current: number | undefined, previous: number | undefined): Trend | null {
  const c = current ?? 0;
  const p = previous ?? 0;
  const pts = Math.round((c - p) * 100);
  if (pts === 0) return { dir: "flat", label: "steady" };
  return { dir: pts > 0 ? "up" : "down", label: `${pts > 0 ? "+" : ""}${pts}pts` };
}
