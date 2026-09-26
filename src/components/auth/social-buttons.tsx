"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";

/**
 * Real OAuth triggers, not decoration - `signInWithOAuth` is one call and
 * costs nothing to wire correctly. What it needs that this repo cannot
 * supply is a Google/Facebook provider actually enabled in the Supabase
 * dashboard (Authentication -> Providers) with real client credentials from
 * Google Cloud Console / Meta for Developers; the same "code is ready,
 * external setup is a one-time thing you do" pattern as PAYMONGO_SECRET_KEY
 * or the maps provider elsewhere in .env.local. Until a provider is enabled,
 * Supabase returns a clear "provider not enabled" error rather than the
 * button silently doing nothing.
 */
export function SocialButtons() {
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<"google" | "facebook" | null>(null);

  async function signInWith(provider: "google" | "facebook") {
    setError(null);
    setLoading(provider);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (oauthError) {
      setError(friendlyError(oauthError));
      setLoading(null);
    }
    // On success the browser is redirected to the provider - nothing left to do here.
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => signInWith("google")}
          disabled={loading !== null}
          className="flex h-12 items-center justify-center gap-2 rounded-lg border border-line bg-card text-sm font-semibold text-fg transition-transform active:scale-[0.97] disabled:opacity-60"
        >
          {loading === "google" ? (
            <Loader2 aria-hidden className="size-4.5 animate-spin" />
          ) : (
            <GoogleGlyph className="size-4.5" />
          )}
          Google
        </button>
        <button
          type="button"
          onClick={() => signInWith("facebook")}
          disabled={loading !== null}
          className="flex h-12 items-center justify-center gap-2 rounded-lg border border-line bg-card text-sm font-semibold text-fg transition-transform active:scale-[0.97] disabled:opacity-60"
        >
          {loading === "facebook" ? (
            <Loader2 aria-hidden className="size-4.5 animate-spin" />
          ) : (
            <FacebookGlyph className="size-4.5" />
          )}
          Facebook
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className={className}>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.5 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.5 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.5-2.1 14.3-5.6l-6.6-5.6C29.6 34.7 27 35.5 24 35.5c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.6 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-1 2.9-2.9 5.3-5.4 7l6.6 5.6C39.2 38 44 32.5 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}

function FacebookGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className={className}>
      <path
        fill="#1877F2"
        d="M24 4C12.95 4 4 12.95 4 24c0 9.98 7.31 18.25 16.87 19.76V29.7h-5.08V24h5.08v-4.34c0-5.02 2.99-7.79 7.56-7.79 2.19 0 4.48.39 4.48.39v4.93h-2.52c-2.49 0-3.27 1.55-3.27 3.13V24h5.56l-.89 5.7h-4.67v14.06C36.69 42.25 44 33.98 44 24c0-11.05-8.95-20-20-20z"
      />
    </svg>
  );
}
