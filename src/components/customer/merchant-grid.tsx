import Link from "next/link";
import { Clock, Star, UtensilsCrossed } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FavoriteButton } from "@/components/customer/favorite-button";
import { cn } from "@/lib/utils";
import { formatDistance } from "@/lib/format";
import type { MerchantCard } from "@/lib/types/domain";

/**
 * One store card. Shared by discovery and search so they cannot drift apart
 * - discovery lays these out in a horizontal MerchantRow, search in a
 * wrapping MerchantGrid, but the tile itself is identical either way.
 *
 * Image-forward on purpose: the photo is the thing a hungry person actually
 * scans a list on, so it gets more height than a details row would need, and
 * the rating/favorite controls ride on top of it as floating badges rather
 * than competing for space in the text block underneath.
 */
export function MerchantTile({
  merchant,
  favorited = false,
  dimmed = false,
  className,
}: {
  merchant: MerchantCard;
  favorited?: boolean;
  dimmed?: boolean;
  className?: string;
}) {
  return (
    <Card interactive className={cn("rounded-[22px] shadow-tile", dimmed && "opacity-90", className)}>
      <div className="relative h-29.5 bg-coral-tint">
        <Link href={`/store/${merchant.slug}`} className="absolute inset-0" tabIndex={-1} aria-hidden />
        {merchant.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={merchant.cover_url}
            alt=""
            className={cn("pointer-events-none size-full object-cover", dimmed && "grayscale opacity-70")}
          />
        ) : (
          <div className="pointer-events-none grid size-full place-items-center">
            <UtensilsCrossed aria-hidden className="size-8 text-primary/40" />
          </div>
        )}

        {!dimmed && merchant.rating_count > 0 && merchant.rating_avg >= 4.5 && (
          <span className="absolute top-2.5 left-2.5 rounded-pill bg-mint-pastel px-2.5 py-1 text-[11px] font-bold text-accent-fg">
            Top rated
          </span>
        )}
        {dimmed && (
          <span className="absolute bottom-2.5 left-2.5 rounded-pill bg-card px-2.5 py-1 text-xs font-bold text-fg-muted shadow-card">
            Closed
          </span>
        )}

        <FavoriteButton
          merchantId={merchant.id}
          initialFavorited={favorited}
          className="absolute top-2.5 right-2.5 size-8 bg-card text-primary shadow-card hover:bg-card hover:brightness-95"
        />
      </div>

      <Link href={`/store/${merchant.slug}`} className="block px-3.5 pt-3 pb-3.5">
        <h3 className="truncate text-[15px] font-bold">{merchant.name}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-xs font-medium text-[#5e5450]">
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
          <span>{formatDistance(merchant.distance_m)}</span>
        </div>
      </Link>
    </Card>
  );
}

/** Image-forward card, not a details row: `Pill` (min-order text) dropped
    from the meta row to match the mockup's tighter rating/prep/distance
    line - the minimum order is still visible on the store page itself. */

/**
 * Discover's horizontal scroller - no heading, no wrapper, just the tiles.
 * `snap-x` + each tile's implicit scroll-snap-align (inherited by the
 * browser default for a flex child inside a snap container is "none", so
 * this sets it explicitly) keeps the strip settling on a whole tile rather
 * than stopping mid-card.
 */
export function MerchantRow({
  merchants,
  favoritedIds,
  dimmed = false,
}: {
  merchants: MerchantCard[];
  favoritedIds: Set<string>;
  dimmed?: boolean;
}) {
  if (merchants.length === 0) return null;

  return (
    <ul className="-mx-5 flex snap-x gap-3.5 overflow-x-auto px-5 pb-1">
      {merchants.map((m) => (
        <li key={m.id} className="w-58 flex-none snap-start">
          <MerchantTile merchant={m} favorited={favoritedIds.has(m.id)} dimmed={dimmed} />
        </li>
      ))}
    </ul>
  );
}

/** Search's wrapping grid - same tile, different arrangement. No border or
    fill around the group any more: the tile's own shadow-tile already
    separates it from the cream ground without needing a second box. */
export function MerchantGrid({
  heading,
  merchants,
  favoritedIds = new Set(),
  dimmed = false,
}: {
  heading?: string;
  merchants: MerchantCard[];
  favoritedIds?: Set<string>;
  dimmed?: boolean;
}) {
  if (merchants.length === 0) return null;

  return (
    <section>
      {heading && (
        <h2 className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">{heading}</h2>
      )}
      <ul className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {merchants.map((m) => (
          <li key={m.id}>
            <MerchantTile merchant={m} favorited={favoritedIds.has(m.id)} dimmed={dimmed} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Default map centre until geolocation and the saved-address picker land. */
export const DEFAULT_LOCATION = {
  lat: 10.3157,
  lng: 123.8893,
  label: "Cebu City",
};
