import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Receipt, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { EmptyState } from "@/components/ui/empty-state";
import { OrderHistoryCard, type OrderHistoryRow } from "@/components/customer/order-history-card";

export const metadata: Metadata = { title: "Order history" };

const PAGE_SIZE = 25;

const SELECT =
  "id, code, status, total_centavos, created_at, delivered_at, cancelled_at, " +
  "merchants(name, cover_url), order_items(name_snapshot, quantity)";

/**
 * A Manila calendar day, as the UTC instant range it actually covers - same
 * reasoning as the merchant order history page: created_at is stored in UTC,
 * so a naive UTC-midnight filter would put entries from the last 8 hours of
 * a Manila day into the next day's results.
 */
function manilaDayRangeUtc(dateStr: string): { gte: string; lt: string } {
  const start = new Date(`${dateStr}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { gte: start.toISOString(), lt: end.toISOString() };
}

export default async function OrderHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; date?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { page: pageParam, q = "", date = "" } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  // RLS restricts this to the caller's own orders, same as the main list.
  let query = supabase
    .from("orders")
    .select(SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const code = q.trim();
  if (code) query = query.ilike("code", `%${code}%`);
  if (date) {
    const { gte, lt } = manilaDayRangeUtc(date);
    query = query.gte("created_at", gte).lt("created_at", lt);
  }

  const { data, count } = await query;
  const orders = (data ?? []) as unknown as OrderHistoryRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(code || date);

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (code) params.set("q", code);
    if (date) params.set("date", date);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/orders/history?${qs}` : "/orders/history";
  }

  return (
    <>
      <ScreenHeader
        title="Order history"
        subtitle={`${total} ${total === 1 ? "order" : "orders"}`}
        backHref="/orders"
        titleClassName="font-bold"
      >
        <form action="/orders/history" method="get" className="flex flex-wrap items-end gap-2">
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
            className="inline-flex h-11 items-center gap-2 rounded-md bg-white px-5 font-semibold text-header hover:bg-coral-tint"
          >
            <Search aria-hidden className="size-4" />
            Search
          </button>
          {filtered && (
            <Link
              href="/orders/history"
              className="inline-flex h-11 items-center px-3 text-sm font-semibold text-header-fg underline-offset-2 hover:underline"
            >
              Clear
            </Link>
          )}
        </form>
      </ScreenHeader>

      <div className="space-y-4 px-4 py-6">
        {orders.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-6" />}
            title={filtered ? "No orders match your search" : "No orders yet"}
          />
        ) : (
          <ul className="space-y-2">
            {orders.map((order) => (
              <li key={order.id}>
                <OrderHistoryCard order={order} />
              </li>
            ))}
          </ul>
        )}

        {orders.length > 0 && totalPages > 1 && (
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
