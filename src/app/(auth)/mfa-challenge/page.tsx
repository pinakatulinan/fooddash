import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { MfaChallengeForm } from "./mfa-challenge-form";

export const metadata: Metadata = { title: "Verify it's you" };

/**
 * Only reachable mid-login: signIn() (actions.ts) redirects here itself when
 * a password alone leaves the session at aal1 but the account has a
 * verified authenticator factor. Landing here any other way - a stale
 * bookmark, an account with no factor - has nothing to verify, so it sends
 * them on rather than showing a code box that can never be satisfied.
 */
export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { next } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.nextLevel !== "aal2" || aal.nextLevel === aal.currentLevel) {
    redirect(next || "/");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg-subtle px-6 py-10">
      <div className="w-full max-w-sm rounded-lg border border-line bg-card p-6 shadow-pop">
        <div className="mb-5 flex flex-col items-center text-center">
          <span aria-hidden className="mb-3 grid size-12 place-items-center rounded-pill bg-mint-tint text-accent-fg">
            <ShieldCheck className="size-6" />
          </span>
          <h1 className="text-xl font-extrabold tracking-tight">Verify it&apos;s you</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Enter the 6-digit code from your authenticator app.
          </p>
        </div>
        <MfaChallengeForm next={next ?? ""} />
      </div>
    </div>
  );
}
