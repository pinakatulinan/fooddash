"use client";

import * as React from "react";
import { useActionState } from "react";
import { Bike, Eye, EyeOff, Lock, Mail, Phone, Store, User } from "lucide-react";
import { signUp, type AuthState } from "../actions";
import { SwipeButton } from "@/components/ui/swipe-button";
import { SocialButtons } from "@/components/auth/social-buttons";
import { AuthInput, AuthLabel } from "@/components/auth/auth-field";
import { cn } from "@/lib/utils";

const INITIAL: AuthState = { error: null, notice: null };

/**
 * Only these three roles are self-serve. `admin` and `support` are granted by
 * an existing admin — the database ignores any other value that arrives in the
 * signup metadata, so this list is a convenience, not a control.
 */
const ROLES = [
  { value: "customer", label: "Order food", icon: User },
  { value: "merchant", label: "List my store", icon: Store },
  { value: "rider", label: "Deliver", icon: Bike },
] as const;

const PHONE_HINT: Record<string, string> = {
  customer: "Riders use this to reach you about your delivery.",
  merchant: "Optional. Ops use this to reach you about your store.",
  rider: "Required. Customers and ops call this during a delivery.",
};

export function SignupForm() {
  const [state, formAction] = useActionState(signUp, INITIAL);
  const [role, setRole] = React.useState<string>("customer");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [mismatch, setMismatch] = React.useState(false);

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
      <fieldset>
        <legend className="mb-2 block text-sm font-semibold">I want to</legend>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map(({ value, label, icon: Icon }) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-lg border px-2 py-4 text-center",
                "text-xs font-semibold transition-colors",
                role === value
                  ? "border-primary bg-coral-tint text-header-fg"
                  : "border-line hover:bg-surface-raised",
              )}
            >
              <input
                type="radio"
                name="role"
                value={value}
                checked={role === value}
                onChange={() => setRole(value)}
                className="sr-only"
              />
              <Icon aria-hidden className="size-5" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <AuthLabel htmlFor="signup-name">Full name</AuthLabel>
        <AuthInput id="signup-name" icon={User} name="full_name" autoComplete="name" required placeholder="Juan Dela Cruz" />
      </div>

      <div>
        <AuthLabel htmlFor="signup-email">Email</AuthLabel>
        <AuthInput
          id="signup-email"
          icon={Mail}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="Enter your email"
        />
      </div>

      <div>
        <AuthLabel htmlFor="signup-phone">Mobile number</AuthLabel>
        <AuthInput
          id="signup-phone"
          icon={Phone}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required={role === "rider"}
          placeholder="0917 123 4567"
        />
        <p className="mt-1 text-xs text-fg-muted">{PHONE_HINT[role] ?? PHONE_HINT.customer}</p>
      </div>

      <div>
        <AuthLabel htmlFor="signup-password">Password</AuthLabel>
        <AuthInput
          id="signup-password"
          icon={Lock}
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        <p className="mt-1 text-xs text-fg-muted">At least 8 characters.</p>
      </div>

      <div>
        <AuthLabel htmlFor="signup-confirm-password">Confirm password</AuthLabel>
        <AuthInput
          id="signup-confirm-password"
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
          placeholder="Confirm your Password"
        />
        {mismatch && <p className="mt-1 text-xs font-medium text-danger">Passwords do not match.</p>}
      </div>

      {state.error && (
        <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}

      <SwipeButton label="Swipe to Sign up" pendingLabel="Creating account…" />

      {/* OAuth cannot carry a role or a mobile number: an account made this
          way is always a customer. Offering it under "List my store" or
          "Deliver" would quietly create the wrong kind of account. */}
      {role === "customer" && (
        <>
          <div className="flex items-center gap-3 pt-1">
            <div className="h-px flex-1 bg-line" />
            <span className="text-xs font-medium text-fg-muted">Or continue with</span>
            <div className="h-px flex-1 bg-line" />
          </div>

          <SocialButtons />
        </>
      )}
    </form>
  );
}
