"use client";

import * as React from "react";
import { Heart } from "lucide-react";
import { FavoriteMerchantCard, type FavoriteMerchant } from "@/components/customer/favorite-merchant-card";

/**
 * Owns the removal-on-unfavorite interaction the server-rendered list can't:
 * unfavoriting a card should drop it immediately, not leave a stale
 * empty-hearted card sitting there until the next visit. The page's own
 * EmptyState still covers "never favorited anything" (it knows that before
 * any client JS runs); this only covers "favorited it, then changed your
 * mind, in this same visit."
 */
export function FavoritesList({ merchants }: { merchants: FavoriteMerchant[] }) {
  const [items, setItems] = React.useState(merchants);

  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 py-6 text-center text-sm text-fg-muted">
        <Heart aria-hidden className="size-4" />
        No favorites left - tap a restaurant&apos;s heart to save it here again.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3">
      {items.map((m, i) => (
        <li key={m.id} className={i === 0 ? "col-span-2" : undefined}>
          <FavoriteMerchantCard
            merchant={m}
            hero={i === 0}
            onRemoved={() => setItems((prev) => prev.filter((x) => x.id !== m.id))}
          />
        </li>
      ))}
    </ul>
  );
}
