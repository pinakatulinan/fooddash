import { cn } from "@/lib/utils";

/**
 * Empty states carry a lot of weight in a marketplace with few merchants on
 * day one, so each one names the reason and offers the next step. "No results"
 * on its own reads as a broken app.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      {icon && (
        <div
          aria-hidden
          className="mb-4 grid size-14 place-items-center rounded-pill bg-header text-header-fg"
        >
          {icon}
        </div>
      )}
      <p className="text-base font-bold">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-fg-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Loading placeholder that matches the shape of what is arriving. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("fd-skeleton", className)} />;
}
