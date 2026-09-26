import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentMerchant } from "@/lib/merchant";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCentavos, formatManilaDate } from "@/lib/format";

export const metadata: Metadata = { title: "Ledger" };

const PAGE_SIZE = 25;

/**
 * A Manila calendar day, as the UTC instant range it actually covers - same
 * reasoning as orders/history's manilaDayRangeUtc: created_at is stored in
 * UTC, so a naive UTC-midnight filter would put entries from the last 8
 * hours of a Manila day into the next day's results.
 */
function manilaDayRangeUtc(dateStr: string): { gte: string; lt: string } {
  const start = new Date(`${dateStr}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { gte: start.toISOString(), lt: end.toISOString() };
}

export default async function MerchantLedgerHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; date?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return (
      <>
        <ScreenHeader title="Ledger" backHref="/merchant/earnings" />
        <EmptyState icon={<Wallet className="size-6" />} title="No store linked to this account" />
      </>
    );
  }

  const { page: pageParam, q = "", date = "" } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  let query = supabase
    .from("ledger_entries")
    .select("id, entry_type, amount_centavos, note, created_at", { count: "exact" })
    .eq("account_type", "merchant")
    .eq("account_id", merchant.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  // note holds the order code (see settle_order, 0008) - the same thing
  // orders/history searches by, just read from a different column here.
  const code = q.trim();
  if (code) query = query.ilike("note", `%${code}%`);
  if (date) {
    const { gte, lt } = manilaDayRangeUtc(date);
    query = query.gte("created_at", gte).lt("created_at", lt);
  }

  const { data, count } = await query;
  const entries = data ?? [];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(code || date);

  const rows = entries.map((e) => ({
    date: formatManilaDate(e.created_at),
    type: e.entry_type.replace(/_/g, " "),
    ref: e.note,
    amount: (
      <span className={e.amount_centavos < 0 ? "text-danger" : ""}>{formatCentavos(e.amount_centavos)}</span>
    ),
  }));

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (code) params.set("q", code);
    if (date) params.set("date", date);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/merchant/earnings/ledger?${qs}` : "/merchant/earnings/ledger";
  }

  return (
    <>
      <ScreenHeader title="Ledger" subtitle={`${total} ${total === 1 ? "entry" : "entries"}`} backHref="/merchant/earnings">
        <form action="/merchant/earnings/ledger" method="get" className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="q" className="sr-only">
              Order code
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={code}
              placeholder="Order code"
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
            className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-fg hover:bg-primary-hover"
          >
            <Search aria-hidden className="size-4" />
            Search
          </button>
          {filtered && (
            <Link
              href="/merchant/earnings/ledger"
              className="inline-flex h-11 items-center px-3 text-sm font-semibold text-header-fg underline-offset-2 hover:underline"
            >
              Clear
            </Link>
          )}
        </form>
      </ScreenHeader>

      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
        <DataTable
          columns={[
            { key: "date", label: "Date", hideOnMobile: true },
            { key: "type", label: "Entry" },
            { key: "ref", label: "Order", mono: true, hideOnMobile: true },
            { key: "amount", label: "Amount", align: "right", mono: true },
          ]}
          rows={rows}
          empty={filtered ? "No entries match your search" : "No entries yet"}
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
