import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { BottomNav } from "@/components/layout/app-nav";
import { NotificationBell } from "@/components/layout/notification-bell";
import { BasketBar } from "@/components/customer/basket-bar";
import { LinkButton } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  // Browsing is public by design - discovery, search and store pages all work
  // signed out. The header is where that state actually becomes visible: a
  // signed-out visitor gets "Sign in" instead of a cart icon that would only
  // fail later, on the first thing that actually needs an account.
  const { user } = isSupabaseConfigured ? await getCurrentUser() : { user: null };

  return (
    <div className="min-h-dvh bg-bg">
      <div className="sticky top-0 z-30 border-b border-line bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" aria-label="FoodDash home">
            <Logo height={24} />
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

      {/* pb-20 clears the bottom tab bar on mobile; it is a fixed element and
          would otherwise sit on top of the last card in every list. */}
      <main id="main" className="mx-auto w-full max-w-5xl pb-20 md:pb-10">
        {children}
      </main>

      {user && <BasketBar />}

      <BottomNav surface="customer" />
    </div>
  );
}
