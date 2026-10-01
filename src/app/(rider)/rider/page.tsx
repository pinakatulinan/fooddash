import { redirect } from "next/navigation";
import { Banknote, Bike, Store } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { AvailabilityToggle } from "@/components/rider/availability-toggle";
import { OfferActions } from "@/components/rider/offer-actions";
import { OfferCountdownRing } from "@/components/rider/offer-countdown-ring";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { formatCentavos, formatDistance } from "@/lib/format";
import type { RiderStatus } from "@/lib/types/domain";

interface Offer {
  id: string;
  status: string;
  offered_at: string;
  expires_at: string;
  payout_centavos: number;
  distance_to_store_m: number | null;
  orders: { code: string; total_centavos: number; payment_method: string } | null;
}

/** The start of "today" in Manila time, as the UTC instant it actually is -
    same reasoning as the order history pages: created_at is stored in UTC,
    so a naive UTC-midnight filter would cut off the last 8 hours of a
    Manila day. Kept out of the component body deliberately - reading the
    clock during render is impure. */
function manilaTodayStartUtc(): string {
  const manilaDateStr = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return new Date(`${manilaDateStr}T00:00:00+08:00`).toISOString();
}

export default async function RiderJobsPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const { profile } = await getCurrentUser();

  const { data: rider } = await supabase
    .from("riders")
    .select("id, status, is_verified, cash_on_hand_centavos, completed_deliveries")
    .maybeSingle();

  const firstName = profile?.full_name?.split(" ")[0] ?? "rider";

  if (!rider) {
    // A rider account with no riders row has not applied yet - the row is
    // only ever created by submit_rider_application. Anyone else (an admin
    // poking around the rider surface) just sees the explanation.
    if (profile?.role === "rider") redirect("/rider/onboarding");

    return (
      <div className="px-5 pt-5">
        <EmptyState
          icon={<Bike className="size-6" />}
          title="This account is not a rider"
          description="Only accounts registered as riders can receive delivery jobs."
        />
      </div>
    );
  }

  // RLS scopes these to the signed-in rider, so no rider_id filter is needed.
  const [{ data: offers }, { data: todayLedger }] = await Promise.all([
    supabase
      .from("delivery_assignments")
      .select(
        "id, status, offered_at, expires_at, payout_centavos, distance_to_store_m, orders(code, total_centavos, payment_method)",
      )
      .eq("status", "offered")
      .order("offered_at", { ascending: false }),
    supabase
      .from("ledger_entries")
      .select("entry_type, amount_centavos")
      .eq("account_type", "rider")
      .in("entry_type", ["rider_earning", "tip"])
      .gte("created_at", manilaTodayStartUtc()),
  ]);

  const pending = (offers ?? []) as unknown as Offer[];
  const todayEntries = todayLedger ?? [];
  const todayEarnings = todayEntries.reduce((sum, e) => sum + e.amount_centavos, 0);
  const todayTrips = todayEntries.filter((e) => e.entry_type === "rider_earning").length;

  return (
    <>
      <RealtimeRefresh table="delivery_assignments" filter={`rider_id=eq.${rider.id}`} />

      <div className="rounded-b-4xl bg-[#1F5F4F] px-5 pt-5 pb-5.5 text-white">
        <p className="text-2xl font-extrabold">Hi, {firstName}</p>
        <p className="mt-0.5 text-[13px] text-[#CFF0E8]">{rider.completed_deliveries} deliveries completed</p>
        <div className="mt-4">
          <AvailabilityToggle initialStatus={rider.status as RiderStatus} isVerified={rider.is_verified} />
        </div>
      </div>

      <div className="space-y-5 px-5 pt-5 pb-6">
        {!rider.is_verified && (
          <div className="rounded-[20px] bg-card p-4 shadow-card">
            <p className="font-bold">Finish your verification</p>
            <p className="mt-0.5 text-sm text-fg-muted">
              See which documents are approved and upload anything still missing.
            </p>
            <LinkButton href="/rider/onboarding" size="sm" className="mt-3">
              Open
            </LinkButton>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[18px] bg-card px-3.5 py-3 shadow-card">
            <p className="text-[11px] font-semibold tracking-wide text-fg-muted uppercase">Today</p>
            <p className="mt-1.5 text-xl font-extrabold tabular-nums">{formatCentavos(todayEarnings)}</p>
            <p className="text-xs text-fg-muted">{todayTrips} {todayTrips === 1 ? "trip" : "trips"}</p>
          </div>
          <div className="rounded-[18px] bg-card px-3.5 py-3 shadow-card">
            <p className="text-[11px] font-semibold tracking-wide text-fg-muted uppercase">Cash on hand</p>
            <p className="mt-1.5 text-xl font-extrabold tabular-nums">
              {formatCentavos(rider.cash_on_hand_centavos)}
            </p>
            <p className="text-xs text-warning">Remit at the hub</p>
          </div>
        </div>

        <section aria-labelledby="offers-heading">
          <h2 id="offers-heading" className="mb-3 text-[15px] font-bold">
            Offers
          </h2>

          {pending.length === 0 ? (
            <div className="rounded-[20px] bg-card shadow-card">
              <EmptyState
                icon={<Bike className="size-6" />}
                title={rider.status === "offline" ? "You are offline" : "No offers right now"}
                description={
                  rider.status === "offline"
                    ? "Go online to start receiving delivery offers near you."
                    : "Stay near a busy area — offers go to the closest available rider first."
                }
              />
            </div>
          ) : (
            <ul className="space-y-3">
              {pending.map((offer) => (
                <li key={offer.id}>
                  <div className="rounded-3xl border-2 border-primary bg-card p-4.5 shadow-pop">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-[13px] font-bold">{offer.orders?.code}</p>
                        <p className="mt-1 text-[32px] leading-none font-extrabold text-primary tabular-nums">
                          {formatCentavos(offer.payout_centavos)}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-muted">payout</p>
                      </div>
                      <OfferCountdownRing offeredAt={offer.offered_at} expiresAt={offer.expires_at} />
                    </div>

                    <div className="mt-3.5 space-y-2">
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-coral-tint text-primary">
                          <Store aria-hidden className="size-3.5" />
                        </span>
                        <span className="text-[13px] font-medium">
                          {formatDistance(offer.distance_to_store_m)} to the store
                        </span>
                      </div>
                      {offer.orders?.payment_method === "cod" && (
                        <div className="flex items-center gap-2.5">
                          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-mint-tint text-accent-fg">
                            <Banknote aria-hidden className="size-3.5" />
                          </span>
                          <span className="text-[13px] font-medium">
                            Cash order · collect {formatCentavos(offer.orders.total_centavos)}
                          </span>
                        </div>
                      )}
                    </div>

                    <OfferActions assignmentId={offer.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
