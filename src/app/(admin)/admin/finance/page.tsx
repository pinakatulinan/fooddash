import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DataTable, StatRow } from "@/components/ui/data-table";
import { formatCentavos, formatManilaDate } from "@/lib/format";

export const metadata: Metadata = { title: "Finance" };

export default async function AdminFinancePage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const [{ data: ledger }, { data: payouts }, { data: refunds }] = await Promise.all([
    supabase
      .from("ledger_entries")
      .select("id, account_type, account_id, entry_type, amount_centavos, note, created_at, payout_id")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("payouts")
      .select("id, payee_type, period_start, period_end, net_centavos, status")
      .order("period_end", { ascending: false })
      .limit(25),
    supabase
      .from("refunds")
      .select("id, amount_centavos, reason, liable_party, status, created_at")
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const entries = ledger ?? [];
  const sumWhere = (fn: (e: (typeof entries)[number]) => boolean) =>
    entries.filter(fn).reduce((s, e) => s + e.amount_centavos, 0);

  const commission = sumWhere((e) => e.account_type === "platform" && e.entry_type === "platform_commission");
  const owedMerchants = sumWhere((e) => e.account_type === "merchant" && !e.payout_id);
  const owedRiders = sumWhere(
    (e) => e.account_type === "rider" && !e.payout_id && e.entry_type !== "cash_collected",
  );
  const cashOut = -sumWhere((e) => e.entry_type === "cash_collected");

  return (
    <>
      <ScreenHeader title="Finance" subtitle="Most recent 100 ledger entries" />

      <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6">
        <StatRow
          stats={[
            { label: "Platform commission", value: formatCentavos(commission) },
            { label: "Owed to merchants", value: formatCentavos(owedMerchants) },
            { label: "Owed to riders", value: formatCentavos(owedRiders) },
            { label: "COD cash outstanding", value: formatCentavos(cashOut), tone: "warn" },
          ]}
        />

        <section aria-labelledby="ledger">
          <h2 id="ledger" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Ledger
          </h2>
          {/* Append-only: a correction is a new adjustment entry, never an edit. */}
          <DataTable
            columns={[
              { key: "date", label: "Date", hideOnMobile: true },
              { key: "account", label: "Account" },
              { key: "type", label: "Entry" },
              { key: "ref", label: "Order", mono: true, hideOnMobile: true },
              { key: "settled", label: "Settled", hideOnMobile: true },
              { key: "amount", label: "Amount", align: "right", mono: true },
            ]}
            rows={entries.map((e) => ({
              date: formatManilaDate(e.created_at),
              account: e.account_type,
              type: e.entry_type.replace(/_/g, " "),
              ref: e.note,
              settled: e.payout_id ? "paid out" : "pending",
              amount: (
                <span className={e.amount_centavos < 0 ? "text-danger" : ""}>
                  {formatCentavos(e.amount_centavos)}
                </span>
              ),
            }))}
            empty="No ledger entries yet"
            emptyDescription="Entries are written by settle_order() when a delivery completes."
          />
        </section>

        <section aria-labelledby="payouts">
          <h2 id="payouts" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Payouts
          </h2>
          <DataTable
            columns={[
              { key: "payee", label: "Payee" },
              { key: "period", label: "Period" },
              { key: "status", label: "Status" },
              { key: "net", label: "Net", align: "right", mono: true },
            ]}
            rows={(payouts ?? []).map((p) => ({
              payee: p.payee_type,
              period: `${formatManilaDate(p.period_start)} – ${formatManilaDate(p.period_end)}`,
              status: p.status,
              net: formatCentavos(p.net_centavos),
            }))}
            empty="No payout runs yet"
            emptyDescription="The payout runner is scheduled work that has not been built."
          />
        </section>

        <section aria-labelledby="refunds">
          <h2 id="refunds" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Refunds
          </h2>
          <DataTable
            columns={[
              { key: "date", label: "Date" },
              { key: "reason", label: "Reason" },
              { key: "liable", label: "Absorbed by" },
              { key: "status", label: "Status" },
              { key: "amount", label: "Amount", align: "right", mono: true },
            ]}
            rows={(refunds ?? []).map((r) => ({
              date: formatManilaDate(r.created_at),
              reason: r.reason,
              liable: r.liable_party,
              status: r.status,
              amount: formatCentavos(r.amount_centavos),
            }))}
            empty="No refunds"
          />
        </section>
      </div>
    </>
  );
}
