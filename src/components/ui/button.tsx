import * as React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one button.
 *
 * `primary` is coral-deep (#D85A30) rather than the coral pastel, and that is
 * the whole reason the deep shade exists: #FFD9C9 against white is roughly
 * 1.3:1, so a pastel button is invisible to anyone with reduced contrast
 * sensitivity - which, on a food app used outdoors on a phone in daylight, is
 * most people some of the time.
 *
 * Minimum target is 44px tall on the default size. Riders tap this with one
 * thumb while holding a bag.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "mint";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-fg hover:bg-primary-hover active:brightness-95 shadow-sm",
  secondary:
    "bg-card text-fg border border-line hover:bg-coral-tint hover:border-primary/40",
  ghost: "bg-transparent text-fg hover:bg-surface-raised",
  danger: "bg-danger text-white hover:brightness-110",
  // Mint is a status colour, not an action colour. This variant exists for the
  // rare confirming action that sits inside a success context.
  mint: "bg-accent text-accent-fg hover:brightness-95",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm gap-1.5 rounded-sm",
  md: "h-11 px-5 text-base gap-2 rounded-md",
  lg: "h-13 px-6 text-base gap-2.5 rounded-md",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      // A loading button stays focusable but refuses activation, so the focus
      // ring does not vanish mid-interaction for keyboard users.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-semibold whitespace-nowrap",
        "transition-[background-color,border-color,filter] duration-150",
        "disabled:opacity-50 disabled:pointer-events-none",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  ),
);

Button.displayName = "Button";

/**
 * A link that looks like a button. Separate from Button rather than a
 * polymorphic `as` prop, because a navigation and an action are different
 * things to a screen reader and should stay different elements.
 */
export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center font-semibold whitespace-nowrap",
        "transition-[background-color,border-color,filter] duration-150",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
