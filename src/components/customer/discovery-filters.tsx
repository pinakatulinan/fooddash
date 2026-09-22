"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { MerchantGrid } from "@/components/customer/merchant-grid";
import type { MerchantCard } from "@/lib/types/domain";

type FilterKey = "top_rated" | "fast" | "nearby";

const FILTERS: { key: FilterKey; label: string; test: (m: MerchantCard) => boolean }[] = [
  { key: "top_rated", label: "Top rated", test: (m) => m.rating_count > 0 && m.rating_avg >= 4.5 },
  { key: "fast", label: "Under 30 min", test: (m) => m.prep_time_minutes <= 30 },
  { key: "nearby", label: "Nearby", test: (m) => m.distance_m <= 2000 },
];

/**
 * Chips filter the already-fetched list client-side rather than re-querying -
 * there is no store-level cuisine/tag field in the schema to filter by
 * server-side yet, only what `nearby_merchants` already returns. This is the
 * DoorDash-shaped chip row without inventing a taxonomy this app doesn't
 * have data for.
 */
export function DiscoveryFilters({ open, closed }: { open: MerchantCard[]; closed: MerchantCard[] }) {
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

  return (
    <>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Filter stores">
        {FILTERS.map((f) => {
          const isActive = active.has(f.key);
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => toggle(f.key)}
              className={cn(
                "shrink-0 rounded-pill border px-3.5 py-2 text-sm font-semibold whitespace-nowrap",
                "transition-[background-color,border-color,transform] duration-150 active:scale-[0.97]",
                isActive
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-line bg-card text-fg hover:bg-surface-raised",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <MerchantGrid heading="Open now" merchants={open.filter(matches)} />
      <MerchantGrid heading="Currently closed" merchants={closed.filter(matches)} dimmed />
    </>
  );
}
