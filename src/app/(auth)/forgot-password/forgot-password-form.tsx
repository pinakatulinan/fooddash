"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Mail } from "lucide-react";
import { requestPasswordReset, type AuthState } from "../actions";
import { Button } from "@/components/ui/button";
import { AuthInput, AuthLabel } from "@/components/auth/auth-field";

const INITIAL: AuthState = { error: null, notice: null };

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordReset, INITIAL);

  if (state.notice) {
    return (
      <p
        role="status"
        className="rounded-md border border-line bg-mint-tint px-4 py-3 text-sm font-medium text-accent-fg"
      >
        {state.notice}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <AuthLabel htmlFor="forgot-email">Email</AuthLabel>
        <AuthInput
          id="forgot-email"
          icon={Mail}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          invalid={Boolean(state.error)}
          placeholder="Enter your email"
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
      Send reset link
    </Button>
  );
}
