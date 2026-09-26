import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The coral screen header from the brief: #FFD9C9 ground, #7A3A1F title.
 *
 * That pairing lands near 7:1, which is comfortably AAA - so the header can
 * carry real information rather than being decorative. Anything placed inside
 * it must use header-fg; ordinary --fg on coral drops to about 4:1 and looks
 * muddy next to the title.
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
    <header className={cn("bg-header text-header-fg", className)}>
      <div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-5">
        <div className="flex items-start gap-3">
          {backHref && (
            <Link
              href={backHref}
              aria-label="Go back"
              className="-ml-2 mt-0.5 grid size-9 shrink-0 place-items-center rounded-pill hover:bg-black/5"
            >
              <ChevronLeft aria-hidden className="size-5" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className={cn("truncate text-xl font-extrabold tracking-tight", titleClassName)}>{title}</h1>
            {subtitle && <p className="mt-0.5 text-sm opacity-80">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </header>
  );
}
