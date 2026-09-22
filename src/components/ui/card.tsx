import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Cards are white on white. The palette gives no second background, so
 * separation comes from a 1px #E2E2E2 border plus a very soft shadow - not
 * from a grey fill, which would fight the coral and mint surfaces sitting
 * beside it.
 */
export function Card({
  className,
  interactive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "bg-card border border-line rounded-lg shadow-card overflow-hidden",
        interactive &&
          "transition-[box-shadow,transform] duration-150 hover:shadow-pop focus-within:shadow-pop active:scale-[0.985] cursor-pointer",
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
