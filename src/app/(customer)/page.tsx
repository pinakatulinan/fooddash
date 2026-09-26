import Link from "next/link";
import { Heart, MapPin, Search, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { DEFAULT_LOCATION } from "@/components/customer/merchant-grid";
import { DiscoveryFilters } from "@/components/customer/discovery-filters";
import type { MerchantCard } from "@/lib/types/domain";

/**
 * Discovery.
 *
 * Distance-sorted through the `nearby_merchants` RPC rather than a client-side
 * sort, because the GiST index has to do the ordering for this to stay fast
 * past a few hundred stores.
 */
export default async function DiscoverPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const { user } = await getCurrentUser();

  const { data: address } = await supabase
    .from("addresses")
    .select("id, barangay, city")
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Falls back to the citywide default for a guest, or a signed-in customer
  // who hasn't saved an address yet. The header has no room for a full
  // street address, so this shows the neighbourhood, not the house number.
  let location = DEFAULT_LOCATION;
  if (address) {
    const { data: latlng } = (await supabase
      .rpc("address_location_latlng", { p_address_id: address.id })
      .maybeSingle()) as unknown as { data: { lat: number; lng: number } | null };
    if (latlng?.lat != null && latlng?.lng != null) {
      location = { lat: latlng.lat, lng: latlng.lng, label: address.barangay || address.city };
    }
  }

  const { data, error } = await supabase.rpc("nearby_merchants", {
    p_lat: location.lat,
    p_lng: location.lng,
    p_radius_m: 7000,
    p_limit: 40,
  });

  const merchants = (data ?? []) as MerchantCard[];
  const open = merchants.filter((m) => m.is_open);
  const closed = merchants.filter((m) => !m.is_open);

  return (
    <>
      <section className="bg-header px-4 pt-5 pb-6 text-header-fg">
        <div className="flex items-start justify-between gap-3">
          <p className="flex min-w-0 items-center gap-1.5 truncate text-xs font-bold tracking-wide uppercase opacity-80">
            <MapPin aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">Delivering to {location.label}</span>
          </p>
          {user ? (
            <div className="-mt-1.5 -mr-1.5 flex shrink-0 items-center gap-1">
              <Link
                href="/favorites"
                aria-label="Your favorites"
                className="grid size-10 place-items-center rounded-pill hover:bg-white/15"
              >
                <Heart aria-hidden className="size-5" />
              </Link>
              <NotificationBell surface="customer" />
              <Link
                href="/cart"
                aria-label="Your cart"
                className="relative grid size-10 place-items-center rounded-pill hover:bg-white/15"
              >
                <ShoppingBag aria-hidden className="size-5" />
              </Link>
            </div>
          ) : (
            <LinkButton href="/login" size="sm" variant="secondary" className="shrink-0">
              Sign in
            </LinkButton>
          )}
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Where food finds you.</h1>
        <p className="mt-1 text-sm font-medium opacity-80">
          {open.length} {open.length === 1 ? "kitchen" : "kitchens"} open near you right now.
        </p>
      </section>

      <div className="px-4 pt-4">
        <form action="/search" method="get">
          <label htmlFor="home-search" className="sr-only">
            Search for a store or a dish
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-primary"
            />
            <input
              id="home-search"
              name="q"
              type="search"
              placeholder="Search stores or dishes"
              className="h-12 w-full rounded-pill border-2 border-primary/40 bg-card pl-11 pr-4 text-base text-fg placeholder:text-fg-muted focus-visible:border-primary"
            />
          </div>
        </form>
      </div>

      {error && (
        <p role="alert" className="mx-4 mt-4 rounded-md bg-danger-tint px-4 py-3 text-sm text-danger">
          Could not load nearby stores. {error.message}
        </p>
      )}

      {merchants.length === 0 && !error ? (
        <EmptyState
          icon={<UtensilsCrossed className="size-6" />}
          title="No kitchens here yet"
          description="FoodDash launches one neighbourhood at a time. Run the seed data, or add your first merchant from the ops console."
        />
      ) : (
        <div className="space-y-8 px-4 py-6">
          <DiscoveryFilters open={open} closed={closed} />
        </div>
      )}
    </>
  );
}
