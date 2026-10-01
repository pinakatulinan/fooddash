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
      <div className="relative h-82.5 overflow-hidden bg-surface pt-30 text-center">
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
          className="pointer-events-none absolute inset-x-0 top-0 size-full object-cover object-top"
        />

        <div className="relative mx-auto grid size-26 place-items-center rounded-[30px] bg-card shadow-[0_12px_30px_rgb(122_58_31/0.18)]">
          <Logo variant="mark" height={80} />
        </div>
      </div>

      {/* The card's rounded corners must sit flush with this container's own
          edges - padding lives inside the card below, not here, or the
          rounding shows the hero peeking through a gap at each corner
          instead of reading as one continuous sheet. */}
      <main id="main" className="mx-auto -mt-15.5 w-full max-w-md">
        <div className="min-h-[calc(100dvh-9rem)] rounded-t-4xl bg-card px-6 pt-7 pb-16 shadow-[0_-10px_30px_rgb(122_58_31/0.08)]">
          <h1 className="text-[26px] font-extrabold tracking-[-0.01em]">
            {onSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {onSignup
              ? "Sign up to start ordering from kitchens near you."
              : "Log in to order from kitchens near you."}
          </p>

          <div
            className="mt-5 mb-7 flex rounded-2xl bg-seg p-1"
            role="tablist"
            aria-label="Sign in or create an account"
          >
            <Link
              href="/login"
              role="tab"
              aria-selected={!onSignup}
              className={cn(
                "flex-1 rounded-xl py-2.5 text-center text-sm transition-colors",
                !onSignup
                  ? "bg-card font-bold text-fg shadow-[0_2px_8px_rgb(122_58_31/0.1)]"
                  : "font-semibold text-fg-muted hover:text-fg",
              )}
            >
              Log In
            </Link>
            <Link
              href="/signup"
              role="tab"
              aria-selected={onSignup}
              className={cn(
                "flex-1 rounded-xl py-2.5 text-center text-sm transition-colors",
                onSignup
                  ? "bg-card font-bold text-fg shadow-[0_2px_8px_rgb(122_58_31/0.1)]"
                  : "font-semibold text-fg-muted hover:text-fg",
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
