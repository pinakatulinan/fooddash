import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * The store the signed-in user is working on.
 *
 * RLS already limits merchant_members to this user's rows, so there is no
 * filter here - asking for the first membership is asking for "a store this
 * person works at". A store switcher for multi-branch owners replaces the
 * `limit(1)` later; every caller keeps working.
 */
export async function getCurrentMerchant() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("merchant_members")
    .select(
      `merchant_id, is_owner, can_manage_menu, can_manage_orders,
       merchants(id, name, slug, status, rejection_reason, is_accepting_orders,
                 paused_until, pause_reason, commission_rate, logo_url, cover_url,
                 prep_time_minutes, min_order_centavos, phone, line1, barangay,
                 city, province, postal_code, rating_avg, rating_count)`,
    )
    .limit(1)
    .maybeSingle();

  if (!data?.merchants) return null;

  return {
    ...(data.merchants as unknown as {
      id: string;
      name: string;
      slug: string;
      status: string;
      rejection_reason: string | null;
      is_accepting_orders: boolean;
      paused_until: string | null;
      pause_reason: string | null;
      commission_rate: number;
      logo_url: string | null;
      cover_url: string | null;
      prep_time_minutes: number;
      min_order_centavos: number;
      phone: string | null;
      line1: string | null;
      barangay: string | null;
      city: string | null;
      province: string | null;
      postal_code: string | null;
      rating_avg: number;
      rating_count: number;
    }),
    isOwner: data.is_owner,
    canManageMenu: data.can_manage_menu,
    canManageOrders: data.can_manage_orders,
  };
}
