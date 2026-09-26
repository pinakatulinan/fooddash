import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DataTable } from "@/components/ui/data-table";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 25;

interface Row {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  note: string | null;
  created_at: string;
  profiles: { full_name: string | null } | null;
}

/**
 * A Manila calendar day, as the UTC instant range it actually covers - same
 * reasoning as the order history pages: created_at is stored in UTC, so a
 * naive UTC-midnight filter would put entries from the last 8 hours of a
 * Manila day into the next day's results.
 */
function manilaDayRangeUtc(dateStr: string): { gte: string; lt: string } {
  const start = new Date(`${dateStr}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { gte: start.toISOString(), lt: end.toISOString() };
}

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; date?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { page: pageParam, q = "", date = "" } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  let query = supabase
    .from("admin_audit_log")
    .select("id, action, entity_type, entity_id, note, created_at, profiles(full_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  // One box searches both action and entity type - a search for "merchant"
  // should surface both "approve_merchant" and entity_type "merchant" rows,
  // and there is no reason to make someone guess which column their term is in.
  const term = q.trim();
  if (term) query = query.or(`action.ilike.%${term}%,entity_type.ilike.%${term}%`);
  if (date) {
    const { gte, lt } = manilaDayRangeUtc(date);
    query = query.gte("created_at", gte).lt("created_at", lt);
  }

  const { data, count } = await query;
  const entries = (data ?? []) as unknown as Row[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(term || date);

  const columns = [
    { key: "when", label: "When" },
    { key: "action", label: "Action" },
    { key: "entity", label: "Entity", hideOnMobile: true },
    { key: "by", label: "By", hideOnMobile: true },
    { key: "note", label: "Note", hideOnMobile: true },
  ];

  const rows = entries.map((a) => ({
    when: formatRelative(a.created_at),
    action: a.action,
    entity: `${a.entity_type}${a.entity_id ? ` · ${a.entity_id.slice(0, 8)}` : ""}`,
    by: a.profiles?.full_name ?? "—",
    note: a.note,
  }));

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (term) params.set("q", term);
    if (date) params.set("date", date);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/settings/audit?${qs}` : "/admin/settings/audit";
  }

  return (
    <>
      <ScreenHeader
        title="Audit log"
        subtitle={`${total} ${total === 1 ? "entry" : "entries"}`}
        backHref="/admin/settings"
      >
        <form action="/admin/settings/audit" method="get" className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="q" className="sr-only">
              Action or entity
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={term}
              placeholder="Action or entity type"
              className="h-11 w-full min-w-0 rounded-md border border-line bg-card px-3.5 text-base text-fg placeholder:text-fg-muted"
            />
          </div>
          <div>
            <label htmlFor="date" className="sr-only">
              Date
            </label>
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={date}
              className="h-11 rounded-md border border-line bg-card px-3.5 text-base text-fg"
            />
          </div>
          <button
            type="submit"
            className="inline-flex h-11 items-center gap-2 rounded-md bg-white px-5 font-semibold text-header hover:bg-coral-tint"
          >
            <Search aria-hidden className="size-4" />
            Search
          </button>
          {filtered && (
            <Link
              href="/admin/settings/audit"
              className="inline-flex h-11 items-center px-3 text-sm font-semibold text-header-fg underline-offset-2 hover:underline"
            >
              Clear
            </Link>
          )}
        </form>
      </ScreenHeader>

      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
        <DataTable
          columns={columns}
          rows={rows}
          empty={filtered ? "No entries match your search" : "Nothing logged yet"}
          emptyDescription={
            filtered ? undefined : "Every privileged action lands here. The table has no update or delete policy for anyone."
          }
        />

        {entries.length > 0 && totalPages > 1 && (
          <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="inline-flex items-center gap-1 font-semibold text-primary">
                <ChevronLeft aria-hidden className="size-4" /> Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-fg-muted">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="inline-flex items-center gap-1 font-semibold text-primary">
                Next <ChevronRight aria-hidden className="size-4" />
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </>
  );
}
