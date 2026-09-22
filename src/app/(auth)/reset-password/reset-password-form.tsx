"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, Lock } from "lucide-react";
import { updatePassword, type AuthState } from "../actions";
import { Button } from "@/components/ui/button";
import { AuthInput, AuthLabel } from "@/components/auth/auth-field";

const INITIAL: AuthState = { error: null, notice: null };

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePassword, INITIAL);
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [mismatch, setMismatch] = React.useState(false);

  if (state.notice) {
    return (
      <>
        <p
          role="status"
          className="rounded-md border border-line bg-mint-tint px-4 py-3 text-sm font-medium text-accent-fg"
        >
          {state.notice}
        </p>
        <Link href="/" className="mt-4 block text-center text-sm font-semibold text-primary underline underline-offset-2">
          Continue to FoodDash
        </Link>
      </>
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (password !== confirmPassword) {
      e.preventDefault();
      setMismatch(true);
      return;
    }
    setMismatch(false);
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
      <div>
        <AuthLabel htmlFor="reset-password">New password</AuthLabel>
        <AuthInput
          id="reset-password"
          icon={Lock}
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your new password"
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="grid size-8 place-items-center rounded-pill text-fg-muted hover:bg-surface-raised"
            >
              {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            </button>
          }
        />
        <p className="mt-1 text-xs text-fg-muted">At least 8 characters.</p>
      </div>

      <div>
        <AuthLabel htmlFor="reset-confirm-password">Confirm new password</AuthLabel>
        <AuthInput
          id="reset-confirm-password"
          icon={Lock}
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          required
          invalid={mismatch}
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            if (mismatch) setMismatch(false);
          }}
          placeholder="Confirm your new password"
        />
        {mismatch && <p className="mt-1 text-xs font-medium text-danger">Passwords do not match.</p>}
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
      Update password
    </Button>
  );
}
