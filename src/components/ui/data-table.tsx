import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The list view used across the merchant console and ops board.
 *
 * Ops screens are scanned, not read, so the same table shape everywhere means
 * the eye learns one layout instead of seven. Wide tables scroll inside their
 * own container; the page body never scrolls sideways.
 */

export interface Column {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Tabular figures and a mono face - for codes, IDs and money columns. */
  mono?: boolean;
  /** Hide below the `md` breakpoint, for columns that are nice-to-have. */
  hideOnMobile?: boolean;
}

export function DataTable({
  columns,
  rows,
  empty = "Nothing here yet.",
  emptyDescription,
}: {
  columns: Column[];
  rows: Record<string, React.ReactNode>[];
  empty?: string;
  emptyDescription?: string;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState title={empty} description={emptyDescription} />
      </Card>
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    "px-4 py-3 text-xs font-bold tracking-wide text-fg-muted uppercase whitespace-nowrap",
                    col.align === "right" ? "text-right" : "text-left",
                    col.hideOnMobile && "hidden md:table-cell",
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-4 py-3 align-middle",
                      col.align === "right" ? "text-right" : "text-left",
                      col.mono && "font-mono tabular-nums",
                      col.hideOnMobile && "hidden md:table-cell",
                    )}
                  >
                    {row[col.key] ?? <span className="text-fg-muted">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Summary tiles that sit above a table. Surface before detail. */
export function StatRow({
  stats,
}: {
  stats: { label: string; value: string; tone?: "normal" | "warn" | "danger" }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s) => (
        <Card key={s.label}>
          <div className="p-4">
            <dt className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
              {s.label}
            </dt>
            <dd
              className={cn(
                "mt-1.5 text-xl font-extrabold tracking-tight tabular-nums",
                s.tone === "warn" && "text-warning",
                s.tone === "danger" && "text-danger",
              )}
            >
              {s.value}
            </dd>
          </div>
        </Card>
      ))}
    </dl>
  );
}
