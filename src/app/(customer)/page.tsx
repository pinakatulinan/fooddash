import Link from "next/link";
import { ArrowRight, ChevronDown, Heart, MapPin, Search, UtensilsCrossed } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { DEFAULT_LOCATION } from "@/components/customer/merchant-grid";
import { DiscoveryFilters } from "@/components/customer/discovery-filters";
import { getFavoritedMerchantIds } from "@/lib/favorites";
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
    .select("id, label, barangay, city")
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Falls back to the citywide default for a guest, or a signed-in customer
  // who hasn't saved an address yet. The header has no room for a full
  // street address, so this shows the neighbourhood, not the house number.
  let location = DEFAULT_LOCATION;
  let savedAddressLabel: string | null = null;
  if (address) {
    const { data: latlng } = (await supabase
      .rpc("address_location_latlng", { p_address_id: address.id })
      .maybeSingle()) as unknown as { data: { lat: number; lng: number } | null };
    if (latlng?.lat != null && latlng?.lng != null) {
      location = { lat: latlng.lat, lng: latlng.lng, label: address.barangay || address.city };
      savedAddressLabel = address.label;
    }
  }

  const [{ data, error }, favoritedIds] = await Promise.all([
    supabase.rpc("nearby_merchants", {
      p_lat: location.lat,
      p_lng: location.lng,
      p_radius_m: 7000,
      p_limit: 40,
    }),
    getFavoritedMerchantIds(supabase, user?.id),
  ]);

  const merchants = (data ?? []) as MerchantCard[];
  const open = merchants.filter((m) => m.is_open);
  const closed = merchants.filter((m) => !m.is_open);
  const hero = open[0] ?? merchants[0];

  return (
    <>
      <div className="flex items-center gap-3 px-5 pt-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-fg-muted">Delivering to</p>
          <button type="button" className="mt-0.5 flex items-center gap-1.5 text-left">
            <MapPin aria-hidden className="size-4 shrink-0 text-primary" />
            <span className="truncate text-base font-bold">
              {savedAddressLabel ? `${savedAddressLabel} · ${location.label}` : location.label}
            </span>
            <ChevronDown aria-hidden className="size-4 shrink-0 text-fg-muted" />
          </button>
        </div>
        {user ? (
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/favorites"
              aria-label="Your favorites"
              className="grid size-11 place-items-center rounded-[14px] bg-card shadow-icon hover:bg-coral-tint"
            >
              <Heart aria-hidden className="size-5" />
            </Link>
            <NotificationBell
              surface="customer"
              buttonClassName="size-11 rounded-[14px] bg-card shadow-icon hover:bg-coral-tint"
            />
          </div>
        ) : (
          <LinkButton href="/login" size="sm" variant="secondary" className="shrink-0">
            Sign in
          </LinkButton>
        )}
      </div>

      <div className="px-5 pt-4">
        <form action="/search" method="get">
          <label htmlFor="home-search" className="sr-only">
            Search for a store or a dish
          </label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-[19px] -translate-y-1/2 text-fg" />
            <input
              id="home-search"
              name="q"
              type="search"
              placeholder="Search stores or dishes"
              className="h-[50px] w-full rounded-2xl bg-card pl-11 pr-4 text-[15px] text-fg placeholder:text-fg-muted shadow-card focus-visible:outline-none"
            />
          </div>
        </form>
      </div>

      {error && (
        <p role="alert" className="mx-5 mt-4 rounded-md bg-danger-tint px-4 py-3 text-sm text-danger">
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
        <div className="space-y-2 pt-[18px] pb-6">
          {hero && (
            <div className="relative mx-5 h-[178px] overflow-hidden rounded-3xl bg-hero-brown">
              {hero.cover_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={hero.cover_url}
                  alt=""
                  className="absolute inset-y-0 right-0 h-full w-[62%] object-cover"
                />
              )}
              <div
                aria-hidden
                className="absolute inset-0"
                style={{ background: "linear-gradient(90deg, #7A3A1F 38%, transparent 70%)" }}
              />
              <div className="relative max-w-[200px] p-5 text-white">
                <p className="text-[11px] font-semibold tracking-[0.08em] text-coral-pastel uppercase">
                  {open.length} {open.length === 1 ? "kitchen" : "kitchens"} open now
                </p>
                <h1 className="mt-1.5 text-[25px] leading-[1.08] font-extrabold tracking-[-0.02em]">
                  Where food finds you.
                </h1>
                <Link
                  href="#open-now"
                  className="mt-4 inline-flex items-center gap-2 rounded-pill bg-white py-2 pr-2 pl-4 text-[13px] font-bold text-hero-brown"
                >
                  Order now
                  <span aria-hidden className="grid size-[22px] place-items-center rounded-pill bg-primary text-white">
                    <ArrowRight aria-hidden className="size-3.5" />
                  </span>
                </Link>
              </div>
            </div>
          )}

          <div className="pt-[18px]">
            <DiscoveryFilters open={open} closed={closed} favoritedIds={favoritedIds} />
          </div>
        </div>
      )}
    </>
  );
}
