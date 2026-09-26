import Link from "next/link";
import { Star, UtensilsCrossed } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FavoriteButton } from "@/components/customer/favorite-button";

export interface FavoriteMerchant {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  cover_url: string | null;
  city: string | null;
  barangay: string | null;
  rating_avg: number;
  rating_count: number;
}

/**
 * A saved restaurant, box-photo-first like OrderHistoryCard - distance and
 * open/closed status don't apply here the way they do on the discover grid
 * (a favorite is favorited regardless of either), so this is its own card
 * rather than a forced fit into MerchantTile/MerchantCard.
 */
export function FavoriteMerchantCard({
  merchant,
  onRemoved,
}: {
  merchant: FavoriteMerchant;
  /** Called once the unfavorite write succeeds - lets FavoritesList drop the
      card immediately instead of leaving a stale empty-hearted card until
      the next page load. */
  onRemoved?: () => void;
}) {
  return (
    <Card interactive>
      <div className="flex gap-3 p-3">
        <Link href={`/store/${merchant.slug}`} className="flex min-w-0 flex-1 gap-3">
          <div className="size-16 shrink-0 overflow-hidden rounded-md bg-coral-tint">
            {merchant.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={merchant.cover_url} alt="" className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center">
                <UtensilsCrossed aria-hidden className="size-6 text-primary/40" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <span className="truncate font-bold">{merchant.name}</span>
            {merchant.tagline && <p className="mt-0.5 truncate text-sm text-fg-muted">{merchant.tagline}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
              {merchant.rating_count > 0 && (
                <span className="flex items-center gap-1">
                  <Star aria-hidden className="size-3 fill-current text-primary" />
                  {Number(merchant.rating_avg).toFixed(1)}
                </span>
              )}
              {(merchant.barangay || merchant.city) && (
                <span className="truncate">{[merchant.barangay, merchant.city].filter(Boolean).join(", ")}</span>
              )}
            </div>
          </div>
        </Link>

        <FavoriteButton
          merchantId={merchant.id}
          initialFavorited
          className="text-primary hover:bg-coral-tint"
          onChange={(favorited) => {
            if (!favorited) onRemoved?.();
          }}
        />
      </div>
    </Card>
  );
}
