import type { Metadata } from "next";
import { BadgePercent } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentMerchant } from "@/lib/merchant";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PromoCreatePanel } from "@/components/merchant/promo-create-panel";
import { TogglePromoActive } from "@/components/merchant/toggle-promo-active";
import { formatCentavos, formatManilaDate } from "@/lib/format";

export const metadata: Metadata = { title: "Promos" };

const DESCRIBE: Record<string, (v: number) => string> = {
  percent_off: (v) => `${v}% off`,
  fixed_off: (v) => `${formatCentavos(v)} off`,
  free_delivery: () => "Free delivery",
};

export default async function MerchantPromosPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return (
      <>
        <ScreenHeader title="Promos" />
        <EmptyState icon={<BadgePercent className="size-6" />} title="No store linked to this account" />
      </>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("promos")
    .select(
      "id, code, description, type, value, min_order_centavos, usage_count, usage_limit, starts_at, ends_at, is_active, funded_by",
    )
    .eq("merchant_id", merchant.id)
    .order("created_at", { ascending: false });

  const promos = data ?? [];

  return (
    <>
      <ScreenHeader
        title="Promos"
        subtitle={`${promos.filter((p) => p.is_active).length} active`}
      />

      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
        <PromoCreatePanel merchantId={merchant.id} />

        <DataTable
          columns={[
            { key: "code", label: "Code", mono: true },
            { key: "offer", label: "Offer" },
            { key: "min", label: "Min order", mono: true, hideOnMobile: true },
            { key: "used", label: "Used", align: "right", mono: true },
            { key: "window", label: "Runs until", hideOnMobile: true },
            { key: "state", label: "State", align: "right" },
          ]}
          rows={promos.map((p) => ({
            code: <span className="font-bold">{p.code}</span>,
            offer: DESCRIBE[p.type]?.(Number(p.value)) ?? p.type,
            min: p.min_order_centavos ? formatCentavos(p.min_order_centavos) : "—",
            used: p.usage_limit ? `${p.usage_count} / ${p.usage_limit}` : String(p.usage_count),
            window: p.ends_at ? formatManilaDate(p.ends_at) : "No end date",
            state: <TogglePromoActive promoId={p.id} isActive={p.is_active} />,
          }))}
          empty="No store promos yet"
          emptyDescription="Create one above - store-funded discounts come out of your payout, so you control them here."
        />

        <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-fg-muted">
          Platform-wide promos such as <span className="font-semibold text-fg">WELCOME50</span> are
          funded by FoodDash and do not affect your payout. Only promos you create here are deducted
          from your earnings.
        </p>
      </div>
    </>
  );
}
