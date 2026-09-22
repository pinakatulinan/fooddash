"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

const COPY: Record<string, { title: string; subtitle: string }> = {
  "/login": {
    title: "Welcome back",
    subtitle: "Sign in to continue ordering your favorite meals.",
  },
  "/signup": {
    title: "Create account",
    subtitle: "Join today and start enjoying fast food delivery.",
  },
  "/forgot-password": {
    title: "Reset password",
    subtitle: "Enter your email and we'll send you a link to get back in.",
  },
  "/reset-password": {
    title: "Choose a new password",
    subtitle: "Make it at least 8 characters - you'll use this to sign in from now on.",
  },
};

/**
 * The hero band + tab switcher + white card wrapper shared by every auth
 * screen. A client component because the headline and which tab is active
 * both key off the current route - /login and /signup are two real pages
 * (so back/forward and deep links work, and each keeps its own metadata),
 * not one page toggling client state, so this reads the URL rather than
 * owning it.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onSignup = pathname?.startsWith("/signup");
  const copy = (pathname && COPY[pathname]) || COPY[onSignup ? "/signup" : "/login"];

  return (
    <div className="min-h-dvh bg-bg-subtle">
      <div className="relative overflow-hidden bg-gradient-to-br from-primary to-primary-hover px-6 pt-12 pb-10 text-center text-primary-fg">
        {/* Decorative dot pattern - purely a texture, never carries information. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: "radial-gradient(circle, white 1.5px, transparent 1.5px)",
            backgroundSize: "22px 22px",
          }}
        />
        {/* A soft mint glow, so the hero carries both brand colours - not
            just coral - the same two-tone pairing the logo itself uses. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -left-16 size-56 rounded-pill bg-mint-mark opacity-20 blur-3xl"
        />

        {/* White plaque behind the mark: the logo's own orange half would
            all but disappear directly on this coral gradient otherwise. */}
        <div className="relative mx-auto grid size-16 place-items-center rounded-pill bg-white shadow-pop">
          <Logo variant="mark" height={40} />
        </div>
        <h1 className="relative mt-5 text-[28px] font-extrabold tracking-tight text-balance">{copy.title}</h1>
        <p className="relative mx-auto mt-2 max-w-xs text-sm opacity-90 text-balance">{copy.subtitle}</p>
      </div>

      {/* The card's rounded corners must sit flush with this container's own
          edges - padding lives inside the card below, not here, or the
          rounding shows the hero peeking through a gap at each corner
          instead of reading as one continuous sheet. */}
      <main id="main" className="mx-auto -mt-6 w-full max-w-md">
        <div className="min-h-[calc(100dvh-9rem)] rounded-t-lg bg-card px-6 pt-9 pb-16 shadow-pop">
          <div className="mb-7 flex rounded-pill bg-surface-raised p-1" role="tablist" aria-label="Sign in or create an account">
            <Link
              href="/login"
              role="tab"
              aria-selected={!onSignup}
              className={cn(
                "flex-1 rounded-pill py-2.5 text-center text-sm font-bold transition-colors",
                !onSignup ? "bg-card text-fg shadow-card" : "text-fg-muted hover:text-fg",
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
                onSignup ? "bg-card text-fg shadow-card" : "text-fg-muted hover:text-fg",
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
