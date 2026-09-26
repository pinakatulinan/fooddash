"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound } from "lucide-react";
import { verifyMfaChallenge, type AuthState } from "../actions";
import { Button } from "@/components/ui/button";
import { AuthInput, AuthLabel } from "@/components/auth/auth-field";

const INITIAL: AuthState = { error: null };

export function MfaChallengeForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(verifyMfaChallenge, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <div>
        <AuthLabel htmlFor="mfa-code">6-digit code</AuthLabel>
        <AuthInput
          id="mfa-code"
          icon={KeyRound}
          name="code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoComplete="one-time-code"
          autoFocus
          required
          invalid={Boolean(state.error)}
          placeholder="123456"
        />
      </div>

      {state.error && (
        <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" fullWidth loading={pending}>
      Verify
    </Button>
  );
}
