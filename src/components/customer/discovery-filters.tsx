"use client";

import * as React from "react";
import Link from "next/link";
import { Navigation, Star, Timer, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MerchantRow, MerchantTile } from "@/components/customer/merchant-grid";
import type { MerchantCard } from "@/lib/types/domain";

type FilterKey = "top_rated" | "fast" | "nearby";

const FILTERS: { key: FilterKey; label: string; icon: LucideIcon; test: (m: MerchantCard) => boolean }[] = [
  { key: "top_rated", label: "Top rated", icon: Star, test: (m) => m.rating_count > 0 && m.rating_avg >= 4.5 },
  { key: "fast", label: "Under 30m", icon: Timer, test: (m) => m.prep_time_minutes <= 30 },
  { key: "nearby", label: "Nearby", icon: Navigation, test: (m) => m.distance_m <= 2000 },
];

/**
 * Chips filter the already-fetched list client-side rather than re-querying -
 * there is no store-level cuisine/tag field in the schema to filter by
 * server-side yet, only what `nearby_merchants` already returns.
 *
 * "All" isn't a fourth filter key alongside the other three - it's the
 * cleared state. It reads as active exactly when nothing else is, and
 * tapping it always clears rather than toggles, so there's no way to land on
 * "All is off and so is everything else."
 */
export function DiscoveryFilters({
  open,
  closed,
  favoritedIds,
}: {
  open: MerchantCard[];
  closed: MerchantCard[];
  favoritedIds: Set<string>;
}) {
  const [active, setActive] = React.useState<Set<FilterKey>>(new Set());

  const toggle = (key: FilterKey) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const matches = (m: MerchantCard) =>
    active.size === 0 || FILTERS.every((f) => !active.has(f.key) || f.test(m));

  // Same merchants as the two horizontal rows above, just restacked into one
  // vertical column - a scannable "all of it, in order" list underneath the
  // curated horizontal scrollers, not a replacement for them.
  const all = [...open, ...closed].filter(matches);

  return (
    <>
      <div className="flex gap-3.5 overflow-x-auto px-5 pb-1" role="group" aria-label="Filter stores">
        <FilterChip
          label="All"
          icon={UtensilsCrossed}
          active={active.size === 0}
          onClick={() => setActive(new Set())}
        />
        {FILTERS.map((f) => (
          <FilterChip
            key={f.key}
            label={f.label}
            icon={f.icon}
            active={active.has(f.key)}
            onClick={() => toggle(f.key)}
          />
        ))}
      </div>

      {open.length > 0 && (
        <section id="open-now" aria-labelledby="open-now-heading">
          <div className="flex items-center justify-between px-5 pt-5.5 pb-3">
            <h2 id="open-now-heading" className="text-lg font-bold">
              Open now
            </h2>
            <Link href="/search" className="text-[13px] font-semibold text-primary">
              See all →
            </Link>
          </div>
          <MerchantRow merchants={open.filter(matches)} favoritedIds={favoritedIds} />
        </section>
      )}

      {closed.length > 0 && (
        <section aria-labelledby="closed-heading">
          <h2 id="closed-heading" className="px-5 pt-5.5 pb-3 text-lg font-bold">
            Currently closed
          </h2>
          <MerchantRow merchants={closed.filter(matches)} favoritedIds={favoritedIds} dimmed />
        </section>
      )}

      {(open.length > 0 || closed.length > 0) && (
        <section aria-labelledby="all-heading">
          <h2 id="all-heading" className="px-5 pt-5.5 pb-3 text-lg font-bold">
            All kitchens near you
          </h2>
          <ul className="space-y-3 px-5">
            {all.map((m) => (
              <li key={m.id}>
                <MerchantTile merchant={m} favorited={favoritedIds.has(m.id)} dimmed={!m.is_open} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function FilterChip({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="flex w-16.5 shrink-0 flex-col items-center gap-1.5"
    >
      <span
        aria-hidden
        className={cn(
          "grid size-15 place-items-center rounded-full transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.97]",
          active ? "bg-primary text-white shadow-[0_6px_16px_rgb(194_79_41/0.3)]" : "bg-card text-primary shadow-icon",
        )}
      >
        <Icon aria-hidden className="size-6" />
      </span>
      <span className={cn("text-xs", active ? "font-bold text-primary" : "font-medium text-fg")}>{label}</span>
    </button>
  );
}
