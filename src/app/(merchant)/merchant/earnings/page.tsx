import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentMerchant } from "@/lib/merchant";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DataTable, StatRow } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCentavos, formatManilaDate } from "@/lib/format";

export const metadata: Metadata = { title: "Earnings" };

export default async function MerchantEarningsPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return (
      <>
        <ScreenHeader title="Earnings" />
        <EmptyState icon={<Wallet className="size-6" />} title="No store linked to this account" />
      </>
    );
  }

  const supabase = await createClient();
  const [{ data: stats }, { data: ledger }, { data: payouts }] = await Promise.all([
    supabase.rpc("merchant_stats", { p_merchant_id: merchant.id }),
    supabase
      .from("ledger_entries")
      .select("id, entry_type, amount_centavos, note, created_at, payout_id")
      .eq("account_type", "merchant")
      .eq("account_id", merchant.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("payouts")
      .select("id, period_start, period_end, net_centavos, status")
      .eq("payee_type", "merchant")
      .eq("payee_id", merchant.id)
      .order("period_end", { ascending: false })
      .limit(12),
  ]);

  const s = (stats ?? {}) as Record<string, number>;
  const entries = ledger ?? [];
  // A merchant's balance is simply the sum of their ledger entries.
  const unsettled = entries
    .filter((e) => !e.payout_id)
    .reduce((sum, e) => sum + e.amount_centavos, 0);

  return (
    <>
      <ScreenHeader title="Earnings" subtitle="Last 7 days" />

      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6">
        <StatRow
          stats={[
            { label: "Orders", value: String(s.orders_count ?? 0) },
            { label: "Gross sales", value: formatCentavos(s.gross_centavos ?? 0) },
            { label: "Commission", value: formatCentavos(s.commission_centavos ?? 0) },
            { label: "Awaiting payout", value: formatCentavos(unsettled) },
          ]}
        />

        <section aria-labelledby="ledger">
          <h2 id="ledger" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Ledger
          </h2>
          <DataTable
            columns={[
              { key: "date", label: "Date", hideOnMobile: true },
              { key: "type", label: "Entry" },
              { key: "ref", label: "Order", mono: true, hideOnMobile: true },
              { key: "amount", label: "Amount", align: "right", mono: true },
            ]}
            rows={entries.map((e) => ({
              date: formatManilaDate(e.created_at),
              type: e.entry_type.replace(/_/g, " "),
              ref: e.note,
              amount: (
                <span className={e.amount_centavos < 0 ? "text-danger" : ""}>
                  {formatCentavos(e.amount_centavos)}
                </span>
              ),
            }))}
            empty="No entries yet"
            emptyDescription="Ledger entries are written the moment an order is delivered."
          />
        </section>

        <section aria-labelledby="payouts">
          <h2 id="payouts" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Payouts
          </h2>
          <DataTable
            columns={[
              { key: "period", label: "Period" },
              { key: "status", label: "Status" },
              { key: "net", label: "Net", align: "right", mono: true },
            ]}
            rows={(payouts ?? []).map((p) => ({
              period: `${formatManilaDate(p.period_start)} – ${formatManilaDate(p.period_end)}`,
              status: p.status,
              net: formatCentavos(p.net_centavos),
            }))}
            empty="No payouts yet"
            emptyDescription="Payout runs are scheduled work that has not been built yet."
          />
        </section>
      </div>
    </>
  );
}
