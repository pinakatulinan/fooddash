"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { signOut } from "@/app/(auth)/actions";
import { useCartSummary } from "@/lib/use-cart-summary";
import { NotificationBell } from "./notification-bell";
import { ADMIN_NAV, CUSTOMER_NAV, MERCHANT_NAV, RIDER_NAV } from "./nav-config";

/**
 * Which surface's navigation to render.
 *
 * The nav config is looked up here rather than passed in as a prop, because
 * the items carry Lucide icon *components* and React cannot serialise a
 * function across the server/client boundary. Passing a `surface` string keeps
 * the payload to one word and the icons entirely inside the client bundle.
 */
export type NavSurface = "customer" | "merchant" | "rider" | "admin";

const NAV_FOR_SURFACE = {
  customer: CUSTOMER_NAV,
  merchant: MERCHANT_NAV,
  rider: RIDER_NAV,
  admin: ADMIN_NAV,
} as const;

function isActive(pathname: string, href: string) {
  // "/" must not light up on every page; every other item matches its subtree.
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Rider's surface identity is teal, not coral - the customer/merchant/admin
    default. Keeping this as a lookup rather than a prop on every item means
    adding a fifth surface later is a one-line change here, not a sweep
    through NAV_FOR_SURFACE. */
const ACTIVE_COLOR: Record<NavSurface, string> = {
  customer: "text-primary",
  merchant: "text-primary",
  admin: "text-primary",
  rider: "text-[#1F5F4F]",
};

/**
 * The customer surface's center nav slot: not a tab (it doesn't take you to
 * a page of its own, just /cart), which is why it isn't in CUSTOMER_NAV -
 * raised above the bar rather than sitting in line with the other four.
 * Reads its own count from useCartSummary() rather than a prop, so mounting
 * it is the only thing that opens the subscription - the other three
 * surfaces rendering BottomNav never pay for a cart query they have no use
 * for.
 */
function CartNavButton() {
  const summary = useCartSummary();
  const count = summary?.itemCount ?? 0;

  return (
    <Link
      href="/cart"
      aria-label={count > 0 ? `Your cart, ${count} ${count === 1 ? "item" : "items"}` : "Your cart"}
      className="relative -mt-8.5 grid size-15.5 shrink-0 place-items-center rounded-full border-[5px] border-cream bg-primary text-primary-fg shadow-fab"
    >
      <ShoppingBag aria-hidden className="size-6" />
      {count > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-[10px] bg-[#1F5F4F] px-1 text-[11px] font-bold text-white"
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}

/**
 * Floating bottom tab bar. Mobile only.
 *
 * `mb-[env(safe-area-inset-bottom)]` - margin, not padding, now that this is
 * a floating pill rather than a bar flush with the screen edge: it pushes
 * the whole bar up clear of the iPhone home indicator instead of padding
 * space out inside it.
 */
export function BottomNav({ surface }: { surface: NavSurface }) {
  const pathname = usePathname();

  // A store page's own basket-bar (basket-bar.tsx) sits in exactly this
  // same floating spot and carries the same cart-navigation job this nav's
  // FAB does everywhere else - showing both at once would be two cart
  // buttons stacked on top of each other. Cart and checkout have their own
  // sticky footer in the same spot for the same reason.
  if (
    surface === "customer" &&
    (pathname?.startsWith("/store/") || pathname === "/cart" || pathname === "/checkout")
  ) {
    return null;
  }

  const primary = NAV_FOR_SURFACE[surface].filter((item) => item.primary);
  // Five items need a touch more room than four - the same reason merchant's
  // own icons are a point smaller, generalised to whichever surface it
  // applies to instead of hardcoding by name.
  const iconSize = primary.length >= 5 ? "size-[21px]" : "size-[22px]";
  const activeColor = ACTIVE_COLOR[surface];

  function renderItem({ href, label, icon: Icon }: (typeof primary)[number]) {
    const active = isActive(pathname, href);
    return (
      <li key={href} className="flex flex-1">
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex flex-1 flex-col items-center gap-0.75 text-[11px] transition-colors",
            active ? cn(activeColor, "font-semibold") : "font-medium text-[#7A6A63]",
          )}
        >
          <Icon aria-hidden className={iconSize} strokeWidth={active ? 2.4 : 1.9} />
          <span className="truncate">{label}</span>
        </Link>
      </li>
    );
  }

  // Customer gets a fifth, non-tab slot (the cart FAB) raised between the
  // second and third item - everyone else just maps straight through.
  const items =
    surface === "customer" ? (
      <>
        {primary.slice(0, 2).map(renderItem)}
        <li className="flex flex-1 items-center justify-center">
          <CartNavButton />
        </li>
        {primary.slice(2).map(renderItem)}
      </>
    ) : (
      primary.map(renderItem)
    );

  return (
    <nav
      aria-label="Main"
      className={cn(
        "fixed inset-x-4 bottom-6 z-40 flex h-17 items-center rounded-[26px] bg-card px-1.5 shadow-pop md:hidden",
        "mb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="mx-auto flex w-full max-w-lg items-center">{items}</ul>
    </nav>
  );
}

/** Persistent sidebar. Desktop only - the merchant console and ops board live here. */
export function SideNav({ surface, title }: { surface: NavSurface; title?: string }) {
  const pathname = usePathname();
  const items = NAV_FOR_SURFACE[surface];

  return (
    <aside className="hidden w-60 shrink-0 border-r border-line bg-card md:block">
      <div className="sticky top-0 flex h-dvh flex-col">
        <div className="flex items-start justify-between px-5 py-5">
          <div>
            <Link href="/" aria-label="FoodDash home">
              <Logo height={65} />
            </Link>
            {title && (
              <p className="mt-3 text-xs font-bold tracking-wider text-fg-muted uppercase">
                {title}
              </p>
            )}
          </div>
          {/* The merchant queue is the one desktop surface where "a new order
              is waiting" genuinely needs to reach someone who might be looking
              at any of five different pages, not just Settings. */}
          {surface === "merchant" && <NotificationBell surface="merchant" />}
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-6">
          <ul className="space-y-0.5">
            {items.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors",
                      active
                        ? "bg-header text-header-fg"
                        : "text-fg-muted hover:bg-surface-raised hover:text-fg",
                    )}
                  >
                    <Icon aria-hidden className="size-4.5" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <form action={signOut} className="border-t border-line px-3 py-3">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <LogOut aria-hidden className="size-4.5" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
