import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DataTable, StatRow } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/status-pill";
import { formatCentavos, displayPhone } from "@/lib/format";

export const metadata: Metadata = { title: "Merchants" };

const STATUS_TONE = {
  approved: "success",
  pending_review: "active",
  draft: "neutral",
  suspended: "danger",
  rejected: "danger",
} as const;

export default async function AdminMerchantsPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const { data } = await supabase
    .from("merchants")
    .select(
      "id, name, slug, status, city, phone, commission_rate, is_accepting_orders, min_order_centavos, rating_avg, rating_count, created_at",
    )
    .order("created_at", { ascending: false });

  const merchants = data ?? [];
  const pending = merchants.filter((m) => m.status === "pending_review").length;
  const live = merchants.filter((m) => m.status === "approved" && m.is_accepting_orders).length;

  return (
    <>
      <ScreenHeader
        title="Merchants"
        subtitle={`${merchants.length} total`}
        actions={
          pending > 0 ? <Pill tone="active">{pending} awaiting review</Pill> : undefined
        }
      />

      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        <StatRow
          stats={[
            { label: "Total", value: String(merchants.length) },
            { label: "Approved", value: String(merchants.filter((m) => m.status === "approved").length) },
            { label: "Accepting orders", value: String(live) },
            { label: "Awaiting review", value: String(pending), tone: pending ? "warn" : "normal" },
          ]}
        />

        <DataTable
          columns={[
            { key: "name", label: "Store" },
            { key: "status", label: "Status" },
            { key: "city", label: "City", hideOnMobile: true },
            { key: "phone", label: "Phone", hideOnMobile: true },
            { key: "commission", label: "Commission", align: "right", mono: true, hideOnMobile: true },
            { key: "min", label: "Min order", align: "right", mono: true },
          ]}
          rows={merchants.map((m) => ({
            name: (
              <div>
                <Link href={`/admin/merchants/${m.id}`} className="font-bold text-primary underline-offset-2 hover:underline">
                  {m.name}
                </Link>
                {!m.is_accepting_orders && m.status === "approved" && (
                  <span className="ml-2 text-xs text-fg-muted">paused</span>
                )}
              </div>
            ),
            status: (
              <Pill tone={STATUS_TONE[m.status as keyof typeof STATUS_TONE] ?? "neutral"}>
                {m.status.replace(/_/g, " ")}
              </Pill>
            ),
            city: m.city,
            phone: displayPhone(m.phone),
            commission: `${(Number(m.commission_rate) * 100).toFixed(1)}%`,
            min: m.min_order_centavos ? formatCentavos(m.min_order_centavos) : "—",
          }))}
          empty="No merchants yet"
        />
      </div>
    </>
  );
}
