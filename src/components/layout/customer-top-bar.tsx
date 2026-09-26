"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { NotificationBell } from "@/components/layout/notification-bell";
import { LinkButton } from "@/components/ui/button";
import type { getCurrentUser } from "@/lib/supabase/server";

type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>["user"];

/** Pages with their own coral hero that already carries the page's identity
    and (on "/") its own notification/cart controls - this bar would just be
    redundant chrome stacked above it. */
const HIDDEN_ON = new Set(["/", "/search", "/orders", "/account", "/favorites", "/cart"]);
/** Same idea, but for a dynamic segment ("/store/[slug]") rather than one
    fixed path - matched by prefix instead of exact equality. */
const HIDDEN_ON_PREFIX = ["/store/"];

/**
 * The white top bar for every customer page except the ones matched above.
 * "/" folds the logo away and puts these same notification and cart
 * controls into its own coral hero instead, so they never appear twice;
 * "/search", "/orders", "/account", "/favorites", "/cart" and every
 * "/store/*" page drop them entirely - their own heroes have no room for
 * them (a store page puts a map-pin and a favorite toggle there instead -
 * see StoreHeaderActions).
 */
export function CustomerTopBar({ user }: { user: CurrentUser }) {
  const pathname = usePathname();
  if (pathname && (HIDDEN_ON.has(pathname) || HIDDEN_ON_PREFIX.some((p) => pathname.startsWith(p)))) {
    return null;
  }

  return (
    <div className="sticky top-0 z-30 border-b border-line bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-5xl items-center justify-between px-4">
        <Link href="/" aria-label="FoodDash home">
          <Logo height={65} />
        </Link>
        {user ? (
          <div className="flex items-center gap-1">
            <NotificationBell surface="customer" />
            <Link
              href="/cart"
              aria-label="Your cart"
              className="relative grid size-10 place-items-center rounded-pill hover:bg-surface-raised"
            >
              <ShoppingBag aria-hidden className="size-5" />
            </Link>
          </div>
        ) : (
          <LinkButton href="/login" size="sm" variant="secondary">
            Sign in
          </LinkButton>
        )}
      </div>
    </div>
  );
}
