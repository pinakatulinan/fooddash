import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Receipt, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { EmptyState } from "@/components/ui/empty-state";
import { OrdersTabs } from "@/components/customer/orders-tabs";
import { OrderHistoryCard, type OrderHistoryRow } from "@/components/customer/order-history-card";

export const metadata: Metadata = { title: "Order history" };

const PAGE_SIZE = 25;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const SELECT =
  "id, code, status, total_centavos, created_at, delivered_at, cancelled_at, merchants(name, slug, logo_url)";

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

/** Kept out of the component body deliberately - reading the clock during
    render is impure, and the React compiler is right to complain about it
    even here where the component only ever runs once per request. Only
    groups what is already on the current page - purely a presentation
    grouping of chronologically-sorted rows, not a second query. */
function groupByRecency(orders: OrderHistoryRow[]): { label: string; orders: OrderHistoryRow[] }[] {
  const cutoff = Date.now() - WEEK_MS;
  const thisWeek = orders.filter((o) => new Date(o.created_at).getTime() >= cutoff);
  const earlier = orders.filter((o) => new Date(o.created_at).getTime() < cutoff);
  const groups: { label: string; orders: OrderHistoryRow[] }[] = [];
  if (thisWeek.length > 0) groups.push({ label: "This week", orders: thisWeek });
  if (earlier.length > 0) groups.push({ label: "Earlier", orders: earlier });
  return groups;
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
  const groups = groupByRecency(orders);

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
      <ScreenHeader title="Orders" titleClassName="text-[26px]">
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
              className="h-11 w-full min-w-0 rounded-2xl border-[1.5px] border-line-warm bg-card px-3.5 text-sm text-fg placeholder:text-fg-muted"
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
              className="h-11 rounded-2xl border-[1.5px] border-line-warm bg-card px-3.5 text-sm text-fg"
            />
          </div>
          <button
            type="submit"
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-fg px-5 text-sm font-semibold text-white"
          >
            <Search aria-hidden className="size-4" />
            Search
          </button>
          {filtered && (
            <Link
              href="/orders/history"
              className="inline-flex h-11 items-center px-3 text-sm font-semibold text-primary underline-offset-2 hover:underline"
            >
              Clear
            </Link>
          )}
        </form>
      </ScreenHeader>

      <div className="space-y-5 px-5 pb-6">
        <OrdersTabs active="past" />

        {orders.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-6" />}
            title={filtered ? "No orders match your search" : "No past orders yet"}
          />
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.label}>
                <h2 className="mb-2.5 text-[13px] font-bold text-fg-muted">{group.label}</h2>
                <ul className="space-y-2.5">
                  {group.orders.map((order) => (
                    <li key={order.id}>
                      <OrderHistoryCard order={order} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
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
