import type { Metadata } from "next";
import { Heart } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { FavoritesList } from "@/components/customer/favorites-list";
import type { FavoriteMerchant } from "@/components/customer/favorite-merchant-card";

export const metadata: Metadata = { title: "Favorites" };

interface FavoriteRow {
  merchant_id: string;
  merchants: Omit<FavoriteMerchant, "is_open"> | null;
}

export default async function FavoritesPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { user } = await getCurrentUser();

  if (!user) {
    return (
      <>
        <ScreenHeader title="Favorites" titleClassName="font-bold" />
        <EmptyState
          icon={<Heart className="size-6" />}
          title="Sign in to save favorites"
          description="Keep track of the restaurants you love and get back to them in one tap."
          action={<LinkButton href="/login">Sign in</LinkButton>}
        />
      </>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("favorites")
    .select(
      "merchant_id, merchants(id, slug, name, tagline, cover_url, city, barangay, rating_avg, rating_count, prep_time_minutes)",
    )
    .eq("customer_id", user.id)
    .not("merchant_id", "is", null)
    .order("created_at", { ascending: false });

  const rows = ((data ?? []) as unknown as FavoriteRow[]).filter((f) => f.merchants != null);

  // One RPC per favorite rather than guessing from a distance-radius list -
  // open/closed is exact this way, and a favorites list is a handful of
  // stores, not hundreds, so the parallel fan-out stays cheap.
  const favorites: FavoriteMerchant[] = await Promise.all(
    rows.map(async (f) => {
      const { data: isOpen } = await supabase.rpc("is_merchant_open", { p_merchant_id: f.merchants!.id });
      return { ...f.merchants!, is_open: Boolean(isOpen) };
    }),
  );

  return (
    <>
      <ScreenHeader
        title="Favorites"
        subtitle={`${favorites.length} saved kitchen${favorites.length === 1 ? "" : "s"}`}
      />

      <div className="px-5 pb-6">
        {favorites.length === 0 ? (
          <EmptyState
            icon={<Heart className="size-6" />}
            title="No favorites yet"
            description="Tap the heart on a restaurant's page to save it here."
            action={<LinkButton href="/">Find something to eat</LinkButton>}
          />
        ) : (
          <FavoritesList merchants={favorites} />
        )}
      </div>
    </>
  );
}
