"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/**
 * The hero band + tab switcher + white card wrapper shared by every auth
 * screen. A client component because which tab is active keys off the
 * current route - /login and /signup are two real pages (so back/forward
 * and deep links work, and each keeps its own metadata), not one page
 * toggling client state, so this reads the URL rather than owning it.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onSignup = pathname?.startsWith("/signup");

  return (
    <div className="min-h-dvh bg-bg-subtle">
      <div className="relative overflow-hidden bg-surface pt-25 pb-4 text-center">
        {/* Pre-composed table-top photo that already fades to the cream
            surface within the image itself - no CSS gradient needed on top
            of it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/auth-hero.png"
          alt=""
          aria-hidden
          width={536}
          height={842}
          className="pointer-events-none absolute inset-x-0 top-0 h-72 w-full object-cover object-top"
        />

        <div className="relative mx-auto grid place-items-center">
          <Logo variant="mark" height={104} />
        </div>
      </div>

      {/* The card's rounded corners must sit flush with this container's own
          edges - padding lives inside the card below, not here, or the
          rounding shows the hero peeking through a gap at each corner
          instead of reading as one continuous sheet. */}
      <main id="main" className="mx-auto -mt-6 w-full max-w-md">
        <div className="min-h-[calc(100dvh-9rem)] rounded-t-lg bg-card px-6 pt-9 pb-16 shadow-pop">
          <div
            className="mb-7 flex rounded-pill bg-surface-raised p-1"
            role="tablist"
            aria-label="Sign in or create an account"
          >
            <Link
              href="/login"
              role="tab"
              aria-selected={!onSignup}
              className={cn(
                "flex-1 rounded-pill py-2.5 text-center text-sm font-bold transition-colors",
                !onSignup
                  ? "bg-card text-fg shadow-card"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              Log In
            </Link>
            <Link
              href="/signup"
              role="tab"
              aria-selected={onSignup}
              className={cn(
                "flex-1 rounded-pill py-2.5 text-center text-sm font-bold transition-colors",
                onSignup
                  ? "bg-card text-fg shadow-card"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              Sign Up
            </Link>
          </div>

          {children}
        </div>
      </main>
    </div>
  );
}
