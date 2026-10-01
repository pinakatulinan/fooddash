"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { signIn, type AuthState } from "../actions";
import { SwipeButton } from "@/components/ui/swipe-button";
import { SocialButtons } from "@/components/auth/social-buttons";
import { AuthInput, AuthLabel } from "@/components/auth/auth-field";

const INITIAL: AuthState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(signIn, INITIAL);
  const [showPassword, setShowPassword] = React.useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <div>
        <AuthLabel htmlFor="login-email">Email</AuthLabel>
        <AuthInput
          id="login-email"
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

      <div>
        <AuthLabel htmlFor="login-password">Password</AuthLabel>
        <AuthInput
          id="login-password"
          icon={Lock}
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          invalid={Boolean(state.error)}
          placeholder="Enter your Password"
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
      </div>

      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm font-semibold text-primary">
          Forgot Password?
        </Link>
      </div>

      {state.error && (
        <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}

      <SwipeButton label="Swipe to Login" pendingLabel="Signing in…" />

      <div className="flex items-center gap-3 pt-1">
        <div className="h-px flex-1 bg-line-warm" />
        <span className="text-xs text-fg-muted">or continue with</span>
        <div className="h-px flex-1 bg-line-warm" />
      </div>

      <SocialButtons />
    </form>
  );
}
