import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentMerchant } from "@/lib/merchant";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { EmptyState } from "@/components/ui/empty-state";
import { MenuEditor } from "@/components/merchant/menu-editor";
import type { EditableCategory, EditableMenuItem } from "@/components/merchant/menu-types";

export const metadata: Metadata = { title: "Menu" };

export default async function MerchantMenuPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return (
      <>
        <ScreenHeader title="Menu" />
        <EmptyState icon={<ClipboardList className="size-6" />} title="No store linked to this account" />
      </>
    );
  }

  const supabase = await createClient();
  const [{ data: categories }, { data: items }] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("id, name, is_active, sort_order")
      .eq("merchant_id", merchant.id)
      .order("sort_order"),
    supabase
      .from("menu_items")
      .select(
        `id, category_id, name, description, image_url, base_price_centavos, is_available, is_popular,
         prep_time_minutes, sort_order,
         option_groups(id, name, min_select, max_select,
                        options(id, name, price_delta_centavos, is_available))`,
      )
      .eq("merchant_id", merchant.id)
      .is("archived_at", null)
      .order("sort_order"),
  ]);

  const all = (items ?? []) as unknown as EditableMenuItem[];
  const soldOut = all.filter((i) => !i.is_available).length;

  return (
    <>
      <ScreenHeader title="Menu" subtitle={`${all.length} items · ${soldOut} marked sold out`} />

      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <MenuEditor
          merchantId={merchant.id}
          categories={(categories ?? []) as EditableCategory[]}
          items={all}
        />
      </div>
    </>
  );
}
