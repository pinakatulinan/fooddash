"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Bike, Store, User } from "lucide-react";
import { signUp, type AuthState } from "../actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
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

export function SignupForm() {
  const [state, formAction] = useActionState(signUp, INITIAL);
  const [role, setRole] = useState<string>("customer");

  if (state.notice) {
    return (
      <p
        role="status"
        className="mt-8 rounded-md border border-line bg-mint-tint px-4 py-3 text-sm font-medium text-accent-fg"
      >
        {state.notice}
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <fieldset>
        <legend className="mb-2 block text-sm font-semibold">I want to</legend>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map(({ value, label, icon: Icon }) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-md border px-2 py-4 text-center",
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

      <Field label="Full name" required>
        {({ id, describedBy }) => (
          <Input id={id} aria-describedby={describedBy} name="full_name" autoComplete="name" required />
        )}
      </Field>

      <Field label="Email" required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
          />
        )}
      </Field>

      <Field label="Mobile number" hint="09XX XXX XXXX — riders use this to reach you.">
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0917 123 4567"
          />
        )}
      </Field>

      <Field label="Password" hint="At least 8 characters." required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        )}
      </Field>

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
      Create account
    </Button>
  );
}
