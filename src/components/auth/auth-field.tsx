import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * An icon-prefixed input for the auth screens specifically - the rest of the
 * app uses the plain `Input`/`Field` pair from components/ui/input.tsx.
 * Kept separate rather than folded into the shared one: this pill-leaning,
 * icon-led style is this redesign's look for a login/signup card, not
 * necessarily the house style for every form in the product.
 */
export const AuthInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & {
    icon: React.ComponentType<{ className?: string }>;
    invalid?: boolean;
    trailing?: React.ReactNode;
  }
>(({ icon: Icon, invalid, trailing, className, ...props }, ref) => (
  <div className="relative">
    <Icon
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-fg-muted"
    />
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "h-12 w-full rounded-lg border border-line bg-card pl-10.5 text-base text-fg",
        trailing ? "pr-11" : "pr-3.5",
        "placeholder:text-fg-muted",
        "focus-visible:border-primary",
        invalid && "border-danger",
        className,
      )}
      {...props}
    />
    {trailing && <div className="absolute top-1/2 right-2 -translate-y-1/2">{trailing}</div>}
  </div>
));
AuthInput.displayName = "AuthInput";

export function AuthLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold">
      {children}
    </label>
  );
}
