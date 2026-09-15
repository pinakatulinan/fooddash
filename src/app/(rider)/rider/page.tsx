import { Bike, Wallet } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AvailabilityToggle } from "@/components/rider/availability-toggle";
import { OfferActions } from "@/components/rider/offer-actions";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { formatCentavos, formatDistance, formatRelative } from "@/lib/format";
import type { RiderStatus } from "@/lib/types/domain";

interface Offer {
  id: string;
  status: string;
  expires_at: string;
  payout_centavos: number;
  distance_to_store_m: number | null;
  orders: { code: string; total_centavos: number; payment_method: string } | null;
}

export default async function RiderJobsPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const { profile } = await getCurrentUser();

  const { data: rider } = await supabase
    .from("riders")
    .select("id, status, is_verified, cash_on_hand_centavos, completed_deliveries")
    .maybeSingle();

  if (!rider) {
    return (
      <>
        <ScreenHeader title="Rider" subtitle={profile?.full_name ?? undefined} />
        <EmptyState
          icon={<Bike className="size-6" />}
          title="This account is not a rider yet"
          description="Complete rider signup and upload your licence, OR/CR and NBI clearance to start receiving jobs."
        />
      </>
    );
  }

  // RLS scopes this to the signed-in rider, so no rider_id filter is needed.
  const { data: offers } = await supabase
    .from("delivery_assignments")
    .select("id, status, expires_at, payout_centavos, distance_to_store_m, orders(code, total_centavos, payment_method)")
    .eq("status", "offered")
    .order("offered_at", { ascending: false });

  const pending = (offers ?? []) as unknown as Offer[];

  return (
    <>
      <RealtimeRefresh table="delivery_assignments" filter={`rider_id=eq.${rider.id}`} />

      <ScreenHeader
        title={`Hi, ${profile?.full_name?.split(" ")[0] ?? "rider"}`}
        subtitle={`${rider.completed_deliveries} deliveries completed`}
      >
        <AvailabilityToggle
          initialStatus={rider.status as RiderStatus}
          isVerified={rider.is_verified}
        />
      </ScreenHeader>

      <div className="space-y-6 px-4 py-5">
        {/* COD float. A rider over the cap stops being offered cash orders, so
            this number has to be visible before it becomes a surprise. */}
        <Card>
          <CardBody className="flex items-center gap-3 p-4">
            <span aria-hidden className="grid size-10 place-items-center rounded-pill bg-accent text-accent-fg">
              <Wallet className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
                Cash on hand
              </p>
              <p className="text-lg font-extrabold">
                {formatCentavos(rider.cash_on_hand_centavos)}
              </p>
            </div>
            <p className="max-w-36 text-right text-xs text-fg-muted">
              Remit at the hub to keep receiving cash orders.
            </p>
          </CardBody>
        </Card>

        <section aria-labelledby="offers-heading">
          <h2 id="offers-heading" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Offers
          </h2>

          {pending.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Bike className="size-6" />}
                title={rider.status === "offline" ? "You are offline" : "No offers right now"}
                description={
                  rider.status === "offline"
                    ? "Go online to start receiving delivery offers near you."
                    : "Stay near a busy area — offers go to the closest available rider first."
                }
              />
            </Card>
          ) : (
            <ul className="space-y-2">
              {pending.map((offer) => (
                <li key={offer.id}>
                  <Card>
                    <CardBody className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-bold">{offer.orders?.code}</p>
                          <p className="mt-0.5 text-sm text-fg-muted">
                            {formatDistance(offer.distance_to_store_m)} to the store
                            {offer.orders?.payment_method === "cod" && " · collect cash"}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-lg font-extrabold text-primary">
                            {formatCentavos(offer.payout_centavos)}
                          </p>
                          <p className="text-xs text-fg-muted">
                            expires {formatRelative(offer.expires_at)}
                          </p>
                        </div>
                      </div>
                      <OfferActions assignmentId={offer.id} />
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
