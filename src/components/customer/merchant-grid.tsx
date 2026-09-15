import Link from "next/link";
import { Clock, Star, UtensilsCrossed } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/status-pill";
import { formatCentavosCompact, formatDistance } from "@/lib/format";
import type { MerchantCard } from "@/lib/types/domain";

/** One store card. Shared by discovery and search so they cannot drift apart. */
export function MerchantTile({ merchant, dimmed = false }: { merchant: MerchantCard; dimmed?: boolean }) {
  return (
    <Card interactive className={dimmed ? "opacity-60" : undefined}>
      <Link href={`/store/${merchant.slug}`} className="block">
        <div className="grid h-28 place-items-center bg-coral-tint">
          {merchant.cover_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={merchant.cover_url} alt="" className="size-full object-cover" />
          ) : (
            <UtensilsCrossed aria-hidden className="size-7 text-primary/40" />
          )}
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-bold">{merchant.name}</h3>
            {merchant.rating_count > 0 && (
              <span className="flex shrink-0 items-center gap-1 text-sm font-semibold">
                <Star aria-hidden className="size-3.5 fill-current text-primary" />
                {Number(merchant.rating_avg).toFixed(1)}
              </span>
            )}
          </div>

          {merchant.tagline && (
            <p className="mt-0.5 truncate text-sm text-fg-muted">{merchant.tagline}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Pill tone={merchant.is_open ? "success" : "neutral"} showDot={false}>
              <Clock aria-hidden className="size-3" />
              {merchant.prep_time_minutes} min
            </Pill>
            <Pill tone="neutral" showDot={false}>{formatDistance(merchant.distance_m)}</Pill>
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
    <section>
      {heading && (
        <h2 className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">{heading}</h2>
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
export const DEFAULT_LOCATION = { lat: 10.3157, lng: 123.8893, label: "Cebu City" };
