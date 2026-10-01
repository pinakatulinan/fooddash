import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every merchant id a customer has favorited, as a Set for O(1) "is this one
 * favorited" lookups while mapping a results list. Shared by Discover and
 * Search, which both render the same MerchantTile with its own heart toggle
 * - the store page's own single-merchant check (store/[slug]/page.tsx) is a
 * different shape (one row, not a set) and stays separate.
 */
export async function getFavoritedMerchantIds(
  supabase: SupabaseClient,
  userId: string | null | undefined,
): Promise<Set<string>> {
  if (!userId) return new Set();

  const { data } = await supabase
    .from("favorites")
    .select("merchant_id")
    .eq("customer_id", userId)
    .not("merchant_id", "is", null);

  return new Set((data ?? []).map((f) => f.merchant_id as string));
}
