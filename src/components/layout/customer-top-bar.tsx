"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { NotificationBell } from "@/components/layout/notification-bell";
import { LinkButton } from "@/components/ui/button";
import type { getCurrentUser } from "@/lib/supabase/server";

type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>["user"];

/** Pages with their own coral hero that already carries the page's identity
    and (on "/") its own notification/cart controls - this bar would just be
    redundant chrome stacked above it. */
const HIDDEN_ON = new Set(["/", "/search", "/orders", "/account", "/favorites", "/cart", "/checkout"]);
/** Same idea, but for a dynamic segment ("/store/[slug]") rather than one
    fixed path - matched by prefix instead of exact equality. "/orders/"
    covers both the history list and a single order's tracking page, whose
    map fills the space this bar would otherwise sit in. */
const HIDDEN_ON_PREFIX = ["/store/", "/orders/", "/account/"];

/**
 * The white top bar for every customer page except the ones matched above.
 * "/" folds the logo away and puts its own notification controls into its
 * own coral hero instead, so they never appear twice; "/search", "/orders",
 * "/account", "/favorites", "/cart", "/checkout" and every "/store/*" page
 * drop them entirely - their own heroes have no room for them (a store page
 * puts a map-pin and a favorite toggle there instead - see
 * StoreHeaderActions). No cart icon here at all any more: the floating
 * bottom nav's raised cart button (app-nav.tsx) is visible on every one of
 * these pages already, so a second one here would just be a duplicate.
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
          <NotificationBell surface="customer" />
        ) : (
          <LinkButton href="/login" size="sm" variant="secondary">
            Sign in
          </LinkButton>
        )}
      </div>
    </div>
  );
}
