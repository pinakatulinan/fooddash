import Link from "next/link";
import { Clock, Star, UtensilsCrossed } from "lucide-react";
import { Pill } from "@/components/ui/status-pill";
import { FavoriteButton } from "@/components/customer/favorite-button";
import { cn } from "@/lib/utils";

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
  prep_time_minutes: number;
  is_open: boolean;
}

/**
 * One saved restaurant, as a grid tile rather than MerchantTile's row-card -
 * the favorites grid is its own two-column layout with an oversized first
 * tile, not a reuse of the discovery/search tile shape.
 */
export function FavoriteMerchantCard({
  merchant,
  hero = false,
  onRemoved,
}: {
  merchant: FavoriteMerchant;
  /** The first tile in the grid spans both columns and runs taller. */
  hero?: boolean;
  /** Called once the unfavorite write succeeds - lets FavoritesList drop the
      card immediately instead of leaving a stale empty-hearted card until
      the next page load. */
  onRemoved?: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-[22px] bg-card shadow-tile">
      <Link href={`/store/${merchant.slug}`} className="block">
        <div className={cn("relative bg-coral-tint", hero ? "h-37.5" : "h-27.5")}>
          {merchant.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={merchant.cover_url}
              alt=""
              className={cn("size-full object-cover", !merchant.is_open && "grayscale opacity-70")}
            />
          ) : (
            <div className="grid size-full place-items-center">
              <UtensilsCrossed aria-hidden className="size-8 text-primary/40" />
            </div>
          )}
          {!merchant.is_open && !hero && (
            <span className="absolute bottom-2 left-2 rounded-pill bg-card px-2 py-0.5 text-[11px] font-bold text-fg-muted shadow-card">
              Closed
            </span>
          )}
        </div>

        <div className={cn("px-3 pt-2.5", hero ? "pb-3.5" : "pb-3")}>
          <div className="flex items-start justify-between gap-2">
            <h3 className={cn("truncate font-bold", hero ? "text-[15px]" : "text-sm")}>{merchant.name}</h3>
            {hero && (
              <Pill tone={merchant.is_open ? "success" : "neutral"} showDot={false}>
                {merchant.is_open ? "Open" : "Closed"}
              </Pill>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2.5 text-xs font-medium text-fg-muted">
            {merchant.rating_count > 0 && (
              <span className="flex items-center gap-1">
                <Star aria-hidden className="size-3 fill-current text-star" />
                {Number(merchant.rating_avg).toFixed(1)}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock aria-hidden className="size-3" />
              {merchant.prep_time_minutes} min
            </span>
          </div>
        </div>
      </Link>

      <FavoriteButton
        merchantId={merchant.id}
        initialFavorited
        className={cn(
          "absolute top-2.5 right-2.5 bg-card text-primary shadow-card hover:bg-card hover:brightness-95",
          hero ? "size-8.5" : "size-7.5",
        )}
        onChange={(favorited) => {
          if (!favorited) onRemoved?.();
        }}
      />
    </div>
  );
}
