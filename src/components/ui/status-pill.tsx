import { cn } from "@/lib/utils";
import { ORDER_STATUS, type StatusTone } from "@/lib/domain/order-status";
import type { OrderStatus, UserRole } from "@/lib/types/domain";

/**
 * Status pills - the brief's stated home for mint (#CFF0E8).
 *
 * Tone is never carried by colour alone. Every pill also has a dot and a word,
 * because roughly 1 in 12 men cannot reliably separate the coral from the mint,
 * and because a pill is often the only thing distinguishing "delivered" from
 * "cancelled" in a list of forty rows.
 */

const TONES: Record<StatusTone, string> = {
  neutral: "bg-surface-raised text-fg-muted",
  active: "bg-header text-header-fg",
  success: "bg-accent text-accent-fg",
  danger: "bg-danger-tint text-danger",
};

const DOTS: Record<StatusTone, string> = {
  neutral: "bg-fg-muted",
  active: "bg-primary",
  success: "bg-accent-fg",
  danger: "bg-danger",
};

export function Pill({
  tone = "neutral",
  children,
  showDot = true,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  showDot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1",
        "text-xs font-semibold whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {showDot && <span aria-hidden className={cn("size-1.5 rounded-pill", DOTS[tone])} />}
      {children}
    </span>
  );
}

/**
 * The same order status, worded for whoever is looking at it. Pass the viewer's
 * role and the label follows - see lib/domain/order-status.ts for why.
 */
export function OrderStatusPill({
  status,
  audience = "customer",
  className,
}: {
  status: OrderStatus;
  audience?: Extract<UserRole, "customer" | "merchant" | "rider"> | "ops";
  className?: string;
}) {
  const presentation = ORDER_STATUS[status];
  const label = audience === "ops" ? presentation.label : presentation[audience];

  return (
    <Pill tone={presentation.tone} className={className}>
      {label}
    </Pill>
  );
}
