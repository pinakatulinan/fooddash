import Link from "next/link";
import { Clock, Star, UtensilsCrossed } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { formatCentavosCompact, formatDistance } from "@/lib/format";
import type { MerchantCard } from "@/lib/types/domain";

/**
 * One store card. Shared by discovery and search so they cannot drift apart.
 *
 * Image-forward on purpose: the photo is the thing a hungry person actually
 * scans a list on, so it gets more height than a details row would need, and
 * the rating rides on top of it as a floating badge rather than competing
 * for space in the text block underneath.
 */
export function MerchantTile({
  merchant,
  dimmed = false,
}: {
  merchant: MerchantCard;
  dimmed?: boolean;
}) {
  return (
    <Card interactive className={dimmed ? "opacity-70" : undefined}>
      <Link href={`/store/${merchant.slug}`} className="block">
        <div className="relative h-40 bg-coral-tint">
          {merchant.cover_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={merchant.cover_url}
              alt=""
              className={cn("size-full object-cover", dimmed && "grayscale")}
            />
          ) : (
            <div className="grid size-full place-items-center">
              <UtensilsCrossed aria-hidden className="size-8 text-primary/40" />
            </div>
          )}

          {merchant.rating_count > 0 && (
            <span className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded-pill bg-card/95 px-2 py-1 text-xs font-bold shadow-card backdrop-blur-sm">
              <Star aria-hidden className="size-3 fill-current text-primary" />
              {Number(merchant.rating_avg).toFixed(1)}
            </span>
          )}

          {!merchant.is_open && (
            <span className="absolute bottom-2.5 left-2.5 rounded-pill bg-card/95 px-2.5 py-1 text-xs font-bold text-fg-muted shadow-card backdrop-blur-sm">
              Closed
            </span>
          )}
        </div>

        <div className="p-4">
          <h3 className="truncate font-bold">{merchant.name}</h3>

          {merchant.tagline && (
            <p className="mt-0.5 truncate text-sm text-fg-muted">
              {merchant.tagline}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Pill tone="neutral" showDot={false}>
              <Clock aria-hidden className="size-3" />
              {merchant.prep_time_minutes} min
            </Pill>
            <Pill tone="neutral" showDot={false}>
              {formatDistance(merchant.distance_m)}
            </Pill>
            {merchant.min_order_centavos > 0 && (
              <span className="text-xs text-fg-muted">
                Min {formatCentavosCompact(merchant.min_order_centavos)}
              </span>
            )}
          </div>
        </div>
      </Link>
    </Card>
  );
}

export function MerchantGrid({
  heading,
  merchants,
  dimmed = false,
}: {
  heading?: string;
  merchants: MerchantCard[];
  dimmed?: boolean;
}) {
  if (merchants.length === 0) return null;

  return (
    <section className="rounded-lg border-2 border-line bg-card p-4">
      {heading && (
        <h2 className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
          {heading}
        </h2>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {merchants.map((m) => (
          <li key={m.id}>
            <MerchantTile merchant={m} dimmed={dimmed} />
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
