import type { Metadata } from "next";
import { Heart } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { FavoritesList } from "@/components/customer/favorites-list";

export const metadata: Metadata = { title: "Favorites" };

interface FavoriteRow {
  merchant_id: string;
  merchants: {
    id: string;
    slug: string;
    name: string;
    tagline: string | null;
    cover_url: string | null;
    city: string | null;
    barangay: string | null;
    rating_avg: number;
    rating_count: number;
  } | null;
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
      "merchant_id, merchants(id, slug, name, tagline, cover_url, city, barangay, rating_avg, rating_count)",
    )
    .eq("customer_id", user.id)
    .not("merchant_id", "is", null)
    .order("created_at", { ascending: false });

  const favorites = ((data ?? []) as unknown as FavoriteRow[]).filter((f) => f.merchants != null);

  return (
    <>
      <ScreenHeader title="Favorites" subtitle={`${favorites.length} saved`} titleClassName="font-bold" />

      <div className="px-4 py-6">
        {favorites.length === 0 ? (
          <EmptyState
            icon={<Heart className="size-6" />}
            title="No favorites yet"
            description="Tap the heart on a restaurant's page to save it here."
            action={<LinkButton href="/">Find something to eat</LinkButton>}
          />
        ) : (
          <FavoritesList merchants={favorites.map((f) => f.merchants!)} />
        )}
      </div>
    </>
  );
}
