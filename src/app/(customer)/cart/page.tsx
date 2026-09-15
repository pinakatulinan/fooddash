import type { Metadata } from "next";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { RemoveCartItemButton } from "@/components/customer/remove-cart-item";
import { CartItemQuantity } from "@/components/customer/cart-item-quantity";
import { formatCentavos, formatDelta } from "@/lib/format";
import type { CartQuote } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Your cart" };

/**
 * The cart, priced by the server.
 *
 * Every figure on this page comes from `price_cart` - the same function
 * `place_order` calls at checkout. Nothing is added up in the browser, so the
 * total shown here is by construction the total that will be charged.
 */
export default async function CartPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();

  // RLS scopes carts to the signed-in user, so no filter is needed.
  const { data: cart } = await supabase
    .from("carts")
    .select("id, merchants(name, slug)")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cart) {
    return (
      <>
        <ScreenHeader title="Your cart" />
        <EmptyState
          icon={<ShoppingBag className="size-6" />}
          title="Your cart is empty"
          description="Find a kitchen near you and add something you feel like eating."
          action={<LinkButton href="/">Browse stores</LinkButton>}
        />
      </>
    );
  }

  const { data: address } = await supabase
    .from("addresses")
    .select("id, label, line1, barangay, city")
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase.rpc("price_cart", {
    p_cart_id: cart.id,
    p_address_id: address?.id ?? null,
    p_promo_code: null,
    p_tip_centavos: 0,
    p_order_type: "delivery",
  });

  const quote = data as CartQuote | null;
  const store = cart.merchants as unknown as { name: string; slug: string } | null;

  return (
    <>
      <ScreenHeader
        title="Your cart"
        subtitle={store ? `From ${store.name}` : undefined}
        backHref={store ? `/store/${store.slug}` : "/"}
      />

      <div className="space-y-6 px-4 py-6">
        {error && (
          <p role="alert" className="rounded-md bg-danger-tint px-4 py-3 text-sm text-danger">
            {error.message}
          </p>
        )}

        {quote?.errors?.map((e) => (
          <p
            key={e.code}
            role="alert"
            className="rounded-md bg-warning-tint px-4 py-3 text-sm font-medium text-warning"
          >
            {e.message}
          </p>
        ))}

        <ul className="space-y-2">
          {quote?.lines?.map((line) => (
            <li key={line.cart_item_id}>
              <Card>
                <div className="flex items-start gap-4 p-4">
                  <CartItemQuantity cartItemId={line.cart_item_id} quantity={line.quantity} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{line.name}</p>
                    {line.options.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-sm text-fg-muted">
                        {line.options.map((o) => (
                          <li key={o.option_id}>
                            {o.group_name}: {o.name}{" "}
                            {o.price_delta_centavos !== 0 && (
                              <span className="tabular-nums">
                                {formatDelta(o.price_delta_centavos)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {line.notes && (
                      <p className="mt-1 text-sm text-fg-muted italic">“{line.notes}”</p>
                    )}
                  </div>
                  <p className="shrink-0 font-bold tabular-nums">
                    {formatCentavos(line.line_total_centavos)}
                  </p>
                  <RemoveCartItemButton cartItemId={line.cart_item_id} />
                </div>
              </Card>
            </li>
          ))}
        </ul>

        {quote && (
          <Card>
            <dl className="divide-y divide-line">
              <Row label="Subtotal" value={formatCentavos(quote.subtotal_centavos)} />
              <Row
                label={
                  quote.distance_m ? `Delivery (${(quote.distance_m / 1000).toFixed(1)} km)` : "Delivery"
                }
                value={formatCentavos(quote.delivery_fee_centavos)}
              />
              {quote.service_fee_centavos > 0 && (
                <Row label="Service fee" value={formatCentavos(quote.service_fee_centavos)} />
              )}
              {quote.discount_centavos > 0 && (
                <Row
                  label={`Discount${quote.promo_code ? ` (${quote.promo_code})` : ""}`}
                  value={`−${formatCentavos(quote.discount_centavos)}`}
                  tone="accent"
                />
              )}
              <Row label="Total" value={formatCentavos(quote.total_centavos)} strong />
            </dl>
          </Card>
        )}

        <div className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-fg-muted">
          {address ? (
            <>
              Delivering to <span className="font-semibold text-fg">{address.label}</span> —{" "}
              {[address.line1, address.barangay, address.city].filter(Boolean).join(", ")}
            </>
          ) : (
            <>
              No delivery address saved yet. Add one from{" "}
              <Link href="/account" className="font-semibold text-primary underline underline-offset-2">
                your account
              </Link>{" "}
              to see the delivery fee.
            </>
          )}
        </div>

        <LinkButton
          href="/checkout"
          size="lg"
          fullWidth
          className={quote?.is_valid ? undefined : "pointer-events-none opacity-50"}
          aria-disabled={!quote?.is_valid}
        >
          {quote ? `Checkout — ${formatCentavos(quote.total_centavos)}` : "Checkout"}
        </LinkButton>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  strong = false,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "accent";
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <dt className={strong ? "font-bold" : "text-fg-muted"}>{label}</dt>
      <dd
        className={`tabular-nums ${strong ? "text-lg font-extrabold" : "font-semibold"} ${
          tone === "accent" ? "text-accent-fg" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
