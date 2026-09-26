"use client";

import * as React from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/status-pill";

interface Factor {
  id: string;
  status: string;
}

/**
 * TOTP enrollment for an admin/support account's own login. Optional, not
 * enforced - an account with no verified factor here never hits the
 * /mfa-challenge redirect signIn() (actions.ts) adds for one that does.
 *
 * Enroll/challenge/verify/unenroll all go straight through the browser
 * client's supabase.auth.mfa.* calls rather than a server action: they act
 * on the current session the same way a client-side .rpc() call would, and
 * nothing here touches a service-role-only capability that would require
 * routing through the server.
 */
export function MfaSettings({ initialFactors }: { initialFactors: Factor[] }) {
  const [factors, setFactors] = React.useState(initialFactors);
  const [qrCode, setQrCode] = React.useState<string | null>(null);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [factorId, setFactorId] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const verified = factors.find((f) => f.status === "verified");

  async function startEnroll() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();

    // A leftover unverified factor from an abandoned enrollment attempt
    // blocks a fresh one (TOTP factors are unique per account) - clear it
    // first rather than surfacing that as an error to explain.
    for (const f of factors.filter((x) => x.status !== "verified")) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setBusy(false);
    if (enrollError) {
      setError(friendlyError(enrollError));
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) {
      setBusy(false);
      setError(friendlyError(challengeError));
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    setBusy(false);
    if (verifyError) {
      setError("That code didn't work. Check your device's clock and try again.");
      return;
    }

    const { data: list } = await supabase.auth.mfa.listFactors();
    setFactors(list?.all ?? []);
    setFactorId(null);
    setQrCode(null);
    setSecret(null);
    setCode("");
    setNotice("Two-factor authentication is on for your account.");
  }

  async function cancelEnroll() {
    if (factorId) {
      const supabase = createClient();
      await supabase.auth.mfa.unenroll({ factorId });
    }
    setFactorId(null);
    setQrCode(null);
    setSecret(null);
    setCode("");
    setError(null);
  }

  async function remove(id: string) {
    if (!window.confirm("Turn off two-factor authentication for your account?")) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: id });
    setBusy(false);
    if (unenrollError) {
      setError(friendlyError(unenrollError));
      return;
    }
    setFactors((fs) => fs.filter((f) => f.id !== id));
    setNotice("Two-factor authentication is off.");
  }

  if (qrCode) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          Scan this with an authenticator app (Google Authenticator, Authy, 1Password), then enter the
          6-digit code it shows to finish.
        </p>
        {/* Supabase returns this as an inline SVG data URI - a plain <img>
            renders it, no QR library needed. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrCode} alt="Scan with your authenticator app" className="mx-auto size-48" />
        {secret && (
          <p className="text-center text-xs text-fg-muted">
            Can&apos;t scan it? Enter this code manually: <span className="font-mono font-semibold">{secret}</span>
          </p>
        )}
        <form onSubmit={confirmEnroll} className="space-y-3">
          <Input
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="text-center font-mono text-lg tracking-widest"
            required
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={busy} disabled={code.trim().length < 6}>
              Confirm
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={cancelEnroll}>
              Cancel
            </Button>
          </div>
        </form>
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {verified ? (
            <ShieldCheck aria-hidden className="size-5 text-accent-fg" />
          ) : (
            <ShieldOff aria-hidden className="size-5 text-fg-muted" />
          )}
          <span className="text-sm font-semibold">Authenticator app</span>
        </div>
        <Pill tone={verified ? "success" : "neutral"}>{verified ? "On" : "Off"}</Pill>
      </div>

      {verified ? (
        <Button size="sm" variant="secondary" loading={busy} onClick={() => remove(verified.id)}>
          Turn off
        </Button>
      ) : (
        <Button size="sm" loading={busy} onClick={startEnroll}>
          Set up two-factor authentication
        </Button>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      {notice && !error && <p className="text-sm font-medium text-accent-fg">{notice}</p>}
    </div>
  );
}
