import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The screen header, mobile-refresh style: sits directly on the cream
 * ground rather than its own coral band - the back button is a white
 * squircle instead, and the title carries the weight the old coral band
 * used to. Every surface that renders on a light ground gets this for free;
 * nothing here depends on the customer surface specifically.
 */
export function ScreenHeader({
  title,
  subtitle,
  backHref,
  actions,
  className,
  titleClassName,
  children,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  actions?: React.ReactNode;
  className?: string;
  /** Overrides the title's default font-extrabold - e.g. a page that wants
      a lighter weight without changing every other ScreenHeader in the app. */
  titleClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className={cn("bg-transparent text-fg", className)}>
      <div className="mx-auto w-full max-w-5xl px-5 pt-3 pb-3">
        <div className="flex items-center gap-3">
          {backHref && (
            <Link
              href={backHref}
              aria-label="Go back"
              className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-card shadow-icon hover:bg-coral-tint"
            >
              <ChevronLeft aria-hidden className="size-5" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className={cn("truncate text-[22px] font-extrabold tracking-[-0.01em]", titleClassName)}>
              {title}
            </h1>
            {subtitle && <p className="text-[13px] text-fg-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </header>
  );
}
