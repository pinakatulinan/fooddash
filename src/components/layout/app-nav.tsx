"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { signOut } from "@/app/(auth)/actions";
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

/**
 * Bottom tab bar. Mobile only.
 *
 * `pb-[env(safe-area-inset-bottom)]` is not cosmetic: without it the last row
 * of tabs sits under the iPhone home indicator and the rightmost tab becomes
 * genuinely hard to hit.
 */
export function BottomNav({ surface }: { surface: NavSurface }) {
  const pathname = usePathname();
  const primary = NAV_FOR_SURFACE[surface].filter((item) => item.primary);

  return (
    <nav
      aria-label="Main"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card md:hidden",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="mx-auto flex max-w-lg">
        {primary.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2",
                  "text-[0.6875rem] font-semibold transition-colors",
                  active ? "text-primary" : "text-fg-muted hover:text-fg",
                )}
              >
                <Icon aria-hidden className="size-5" strokeWidth={active ? 2.4 : 1.9} />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
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
              <Logo height={26} />
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
