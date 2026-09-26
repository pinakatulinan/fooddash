import type { Metadata } from "next";
import { Search, SearchX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchBar } from "@/components/customer/search-bar";
import { DEFAULT_LOCATION, MerchantGrid } from "@/components/customer/merchant-grid";
import type { MerchantCard } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Search" };

/**
 * Search runs through the same `nearby_merchants` RPC as discovery, which
 * matches on store name *and* dish name - so "sisig" finds the store that
 * sells it rather than returning nothing.
 *
 * The form submits with GET, so a search is a real URL: shareable, bookmarkable,
 * and working before JavaScript loads.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { q = "" } = await searchParams;
  const term = q.trim();

  let results: MerchantCard[] = [];
  if (term) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("nearby_merchants", {
      p_lat: DEFAULT_LOCATION.lat,
      p_lng: DEFAULT_LOCATION.lng,
      p_radius_m: 7000,
      p_search: term,
      p_limit: 40,
    });
    results = (data ?? []) as MerchantCard[];
  }

  return (
    <>
      <section className="bg-header px-4 py-5 text-header-fg">
        <SearchBar defaultValue={term} />
      </section>

      <div className="px-4 py-6">
        {!term ? (
          <EmptyState
            icon={<Search className="size-6" />}
            title="What are you craving?"
            description="Search by store name or by dish — we look inside every menu near you."
          />
        ) : results.length === 0 ? (
          <EmptyState
            icon={<SearchX className="size-6" />}
            title={`Nothing matched “${term}”`}
            description="Try a shorter word, or browse what is open near you right now."
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-fg-muted">
              {results.length} {results.length === 1 ? "result" : "results"} for “{term}”
            </p>
            <MerchantGrid merchants={results} />
          </>
        )}
      </div>
    </>
  );
}
