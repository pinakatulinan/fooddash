import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, MapPin, ShoppingBag } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { CartItemQuantity } from "@/components/customer/cart-item-quantity";
import { formatCentavos, formatDelta } from "@/lib/format";
import { cn } from "@/lib/utils";
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

      <div className="space-y-5 px-5 pt-1 pb-44">
        {error && (
          <p role="alert" className="rounded-2xl bg-danger-tint px-4 py-3 text-sm text-danger">
            {error.message}
          </p>
        )}

        {quote?.errors?.map((e) => (
          <p
            key={e.code}
            role="alert"
            className="rounded-2xl bg-warning-tint px-4 py-3 text-sm font-medium text-warning"
          >
            {e.message}
          </p>
        ))}

        <ul className="space-y-2.5">
          {quote?.lines?.map((line) => (
            <li key={line.cart_item_id}>
              <div className="flex items-center gap-3 rounded-[20px] bg-card p-3 shadow-card">
                {line.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={line.image_url} alt="" className="size-18 shrink-0 rounded-[14px] object-cover" />
                ) : (
                  <div className="size-18 shrink-0 rounded-[14px] bg-surface-raised" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold">{line.name}</p>
                  {line.options.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-fg-muted">
                      {line.options
                        .map((o) => `${o.name}${o.price_delta_centavos !== 0 ? ` (${formatDelta(o.price_delta_centavos)})` : ""}`)
                        .join(", ")}
                    </p>
                  )}
                  {line.notes && (
                    <p className="mt-0.5 truncate text-xs text-fg-muted italic">“{line.notes}”</p>
                  )}
                  <p className="mt-1.5 text-[15px] font-extrabold tabular-nums">
                    {formatCentavos(line.line_total_centavos)}
                  </p>
                </div>
                <CartItemQuantity cartItemId={line.cart_item_id} quantity={line.quantity} />
              </div>
            </li>
          ))}
        </ul>

        {store && (
          <Link
            href={`/store/${store.slug}`}
            className="block text-[13px] font-semibold text-primary"
          >
            + Add more items
          </Link>
        )}

        <Link
          href="/account/addresses"
          className="flex items-center gap-3 rounded-[20px] bg-card p-3.5 shadow-card"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-coral-tint text-primary">
            <MapPin aria-hidden className="size-4.5" />
          </span>
          <span className="min-w-0 flex-1">
            {address ? (
              <>
                <span className="block text-sm font-bold">{address.label}</span>
                <span className="block truncate text-xs text-fg-muted">
                  {[address.line1, address.barangay, address.city].filter(Boolean).join(", ")}
                </span>
              </>
            ) : (
              <span className="block text-sm font-semibold text-fg-muted">Add a delivery address</span>
            )}
          </span>
          <ChevronRight aria-hidden className="size-4.5 shrink-0 text-fg-muted" />
        </Link>

        {quote && (
          <div className="rounded-[20px] bg-card px-4 py-1 shadow-card">
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
          </div>
        )}

        {!address && (
          <p className="text-center text-xs text-fg-muted">
            No delivery address saved yet —{" "}
            <Link href="/account/addresses/new" className="font-semibold text-primary underline underline-offset-2">
              add one
            </Link>{" "}
            to see your delivery fee.
          </p>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-[28px] bg-card px-5 pt-4 pb-7.5 shadow-[0_-8px_24px_rgb(122_58_31/0.08)]">
        <LinkButton
          href="/checkout"
          size="lg"
          fullWidth
          className={cn("flex items-center justify-between", !quote?.is_valid && "pointer-events-none opacity-50")}
          aria-disabled={!quote?.is_valid}
        >
          <span>Checkout</span>
          <span>{quote ? `${formatCentavos(quote.total_centavos)} →` : "→"}</span>
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
    <div
      className={cn(
        "flex items-center justify-between py-3",
        strong ? "border-t border-line" : "border-b border-dashed border-line-warm",
      )}
    >
      <dt className={cn("text-sm", strong ? "font-bold" : "text-fg-muted")}>{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          strong ? "text-xl font-extrabold" : "text-sm font-semibold",
          tone === "accent" && "text-accent-fg",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
