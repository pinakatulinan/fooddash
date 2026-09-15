import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCentavos, formatManilaDate } from "@/lib/format";

export const metadata: Metadata = { title: "Earnings" };

export default async function RiderEarningsPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const [{ data: rider }, { data: ledger }, { data: remittances }] = await Promise.all([
    supabase
      .from("riders")
      .select("cash_on_hand_centavos, completed_deliveries, cancelled_deliveries")
      .maybeSingle(),
    supabase
      .from("ledger_entries")
      .select("id, entry_type, amount_centavos, note, created_at, payout_id")
      .eq("account_type", "rider")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("rider_remittances")
      .select("id, amount_centavos, method, received_at, created_at")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  if (!rider) {
    return (
      <>
        <ScreenHeader title="Earnings" />
        <div className="px-4 py-5">
          <Card>
            <EmptyState icon={<Wallet className="size-6" />} title="This account is not a rider" />
          </Card>
        </div>
      </>
    );
  }

  const entries = ledger ?? [];
  // Cash entries are a receivable, not income — they are excluded so "earned"
  // means what the rider actually keeps.
  const earned = entries
    .filter((e) => e.entry_type === "rider_earning" || e.entry_type === "tip")
    .reduce((sum, e) => sum + e.amount_centavos, 0);
  const unpaid = entries
    .filter((e) => !e.payout_id && (e.entry_type === "rider_earning" || e.entry_type === "tip"))
    .reduce((sum, e) => sum + e.amount_centavos, 0);

  return (
    <>
      <ScreenHeader title="Earnings" subtitle={`${rider.completed_deliveries} deliveries completed`} />

      <div className="space-y-6 px-4 py-5">
        <div className="grid grid-cols-2 gap-3">
          <Tile label="Earned" value={formatCentavos(earned)} />
          <Tile label="Awaiting payout" value={formatCentavos(unpaid)} />
          <Tile label="Cash on hand" value={formatCentavos(rider.cash_on_hand_centavos)} warn />
          <Tile label="Cancelled" value={String(rider.cancelled_deliveries)} />
        </div>

        <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-fg-muted">
          Cash on hand is money you collected for FoodDash on COD orders. Remit it at the hub — past
          the cap you stop being offered cash jobs.
        </p>

        <section aria-labelledby="ledger">
          <h2 id="ledger" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Recent entries
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
            empty="No earnings yet"
            emptyDescription="Entries appear the moment a delivery is completed."
          />
        </section>

        <section aria-labelledby="remit">
          <h2 id="remit" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Remittances
          </h2>
          <DataTable
            columns={[
              { key: "date", label: "Date" },
              { key: "method", label: "Method" },
              { key: "status", label: "Status" },
              { key: "amount", label: "Amount", align: "right", mono: true },
            ]}
            rows={(remittances ?? []).map((r) => ({
              date: formatManilaDate(r.created_at),
              method: r.method ?? "—",
              status: r.received_at ? "Received" : "Pending",
              amount: formatCentavos(r.amount_centavos),
            }))}
            empty="Nothing remitted yet"
          />
        </section>
      </div>
    </>
  );
}

function Tile({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <Card>
      <div className="p-4">
        <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{label}</p>
        <p
          className={`mt-1.5 text-xl font-extrabold tracking-tight tabular-nums ${
            warn ? "text-warning" : ""
          }`}
        >
          {value}
        </p>
      </div>
    </Card>
  );
}
