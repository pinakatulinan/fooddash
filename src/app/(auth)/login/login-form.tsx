"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signIn, type AuthState } from "../actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

const INITIAL: AuthState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(signIn, INITIAL);

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <input type="hidden" name="next" value={next} />

      <Field label="Email" required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            invalid={Boolean(state.error)}
            placeholder="you@example.com"
          />
        )}
      </Field>

      <Field label="Password" required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            invalid={Boolean(state.error)}
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

/**
 * Split out so `useFormStatus` can read the pending state of the enclosing
 * form. Reading it in the parent would always return false - the hook only
 * sees a form that is above it in the tree.
 */
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" fullWidth loading={pending}>
      Sign in
    </Button>
  );
}
