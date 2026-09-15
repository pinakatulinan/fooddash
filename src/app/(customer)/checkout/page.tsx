import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { CheckoutForm } from "@/components/customer/checkout-form";
import type { CartQuote } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Checkout" };

/**
 * Loads the cart, the address book, and one initial price_cart quote, then
 * hands everything to the interactive form. The form re-quotes on every
 * change; this first call just means the page is not empty on first paint.
 */
export default async function CheckoutPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();

  const { data: cart } = await supabase
    .from("carts")
    .select("id, merchants(name, slug)")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Nothing to check out — send them back rather than showing an empty form.
  if (!cart) redirect("/cart");

  const { data: addresses } = await supabase
    .from("addresses")
    .select("id, label, line1, barangay, city, is_default")
    .is("archived_at", null)
    .order("is_default", { ascending: false });

  const defaultAddressId = addresses?.[0]?.id ?? null;

  const { data: initialQuote } = await supabase.rpc("price_cart", {
    p_cart_id: cart.id,
    p_address_id: defaultAddressId,
    p_promo_code: null,
    p_tip_centavos: 0,
    p_order_type: "delivery",
  });

  const store = cart.merchants as unknown as { name: string; slug: string } | null;

  return (
    <>
      <ScreenHeader title="Checkout" subtitle={store ? `From ${store.name}` : undefined} backHref="/cart" />
      <CheckoutForm
        cartId={cart.id}
        addresses={addresses ?? []}
        initialAddressId={defaultAddressId}
        initialQuote={initialQuote as CartQuote | null}
      />
    </>
  );
}
