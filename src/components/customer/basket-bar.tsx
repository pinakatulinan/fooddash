"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCartSummary, type CartSummary } from "@/lib/use-cart-summary";
import { cn } from "@/lib/utils";
import { formatCentavos } from "@/lib/format";

/**
 * The store page's own basket bar - only there, by design. Everywhere else
 * in the customer app, the floating bottom nav's raised cart button already
 * carries the "you have items waiting" signal (same `useCartSummary()`
 * source), so a second bar saying the same thing would be redundant. On a
 * store page the nav itself steps aside for this instead (see BottomNav's
 * own `/store/` check) - this bar takes over its exact floating position.
 *
 * Deliberately just a count and a total - tapping it goes straight to
 * /cart. Editing the basket happens there, not in a second copy of it
 * living in this bar.
 */
export function BasketBar() {
  const pathname = usePathname();
  const summary = useCartSummary();

  // Keeps showing the last real numbers while sliding out, rather than the
  // content going blank a beat before the bar itself finishes disappearing.
  // Adjusted during render rather than in an effect - see CartItemQuantity
  // for the same pattern and why.
  const [lastSummary, setLastSummary] = React.useState<CartSummary | null>(null);
  if (summary && summary !== lastSummary) {
    setLastSummary(summary);
  }

  const onStorePage = pathname?.startsWith("/store/") ?? false;
  const visible = onStorePage && !!summary;
  const display = summary ?? lastSummary;

  if (!onStorePage) return null;

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "fixed inset-x-4 bottom-6 z-40 flex justify-center",
        "transition-[transform,opacity] duration-300 ease-out",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      {display && (
        <Link
          href="/cart"
          tabIndex={visible ? undefined : -1}
          className="flex h-15.5 w-full max-w-md items-center gap-3 rounded-[22px] bg-fg py-2 pr-2 pl-4.5 text-white shadow-[0_12px_30px_rgb(26_26_26/0.25)] transition-transform active:scale-[0.98]"
        >
          <span
            aria-hidden
            className="grid size-7.5 shrink-0 place-items-center rounded-[10px] bg-primary text-sm font-bold tabular-nums"
          >
            {display.itemCount}
          </span>
          <span className="min-w-0 flex-1 text-sm font-semibold">View cart</span>
          <span className="shrink-0 rounded-2xl bg-primary px-4 py-3 text-[15px] font-bold tabular-nums">
            {formatCentavos(display.subtotalCentavos)}
          </span>
        </Link>
      )}
    </div>
  );
}
