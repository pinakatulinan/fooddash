import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * White cards on a warm cream ground (mobile refresh) - separation comes
 * from a soft warm-tinted shadow, not a border, now that there's an actual
 * second background to show against. `border-0` is explicit, not just an
 * omission: the global `* { border-color: var(--line) }` rule still sets a
 * colour on any border a className adds, it just doesn't add one itself.
 */
export function Card({
  className,
  interactive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "bg-card border-0 rounded-[20px] shadow-card overflow-hidden",
        interactive &&
          "transition-[box-shadow,transform] duration-150 hover:shadow-tile focus-within:shadow-tile active:scale-[0.985] cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pt-5 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-bold tracking-tight", className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-fg-muted mt-1", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-5 py-4 border-t border-line bg-surface", className)} {...props} />
  );
}
