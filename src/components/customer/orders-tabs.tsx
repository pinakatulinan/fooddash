import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Active/Past split lives as two routes (`/orders`, `/orders/history`)
 * rather than client-side tab state - each already has its own query shape
 * (in-progress vs paginated/searchable history) and URL is the natural place
 * for "which page am I on" to live. This is just the shared segmented-control
 * look wrapping two links between them.
 */
export function OrdersTabs({ active, activeCount }: { active: "active" | "past"; activeCount?: number }) {
  return (
    <div className="flex gap-1 rounded-2xl bg-seg p-1">
      <Tab
        href="/orders"
        label={activeCount != null ? `Active · ${activeCount}` : "Active"}
        selected={active === "active"}
      />
      <Tab href="/orders/history" label="Past" selected={active === "past"} />
    </div>
  );
}

function Tab({ href, label, selected }: { href: string; label: string; selected: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex-1 rounded-xl py-2.5 text-center text-sm transition-colors",
        selected ? "bg-card font-bold text-fg shadow-card" : "font-semibold text-fg-muted",
      )}
    >
      {label}
    </Link>
  );
}
