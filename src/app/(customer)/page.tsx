import { MapPin, UtensilsCrossed } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { EmptyState } from "@/components/ui/empty-state";
import { DEFAULT_LOCATION, MerchantGrid } from "@/components/customer/merchant-grid";
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
  const { data, error } = await supabase.rpc("nearby_merchants", {
    p_lat: DEFAULT_LOCATION.lat,
    p_lng: DEFAULT_LOCATION.lng,
    p_radius_m: 7000,
    p_limit: 40,
  });

  const merchants = (data ?? []) as MerchantCard[];
  const open = merchants.filter((m) => m.is_open);
  const closed = merchants.filter((m) => !m.is_open);

  return (
    <>
      <section className="bg-header px-4 pt-5 pb-6 text-header-fg">
        <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase opacity-80">
          <MapPin aria-hidden className="size-3.5" />
          Delivering to {DEFAULT_LOCATION.label}
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Where food finds you.</h1>
        <p className="mt-1 text-sm opacity-80">
          {open.length} {open.length === 1 ? "kitchen" : "kitchens"} open near you right now.
        </p>
      </section>

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
          <MerchantGrid heading="Open now" merchants={open} />
          <MerchantGrid heading="Currently closed" merchants={closed} dimmed />
        </div>
      )}
    </>
  );
}
