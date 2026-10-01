"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Banknote, CreditCard, MapPin, Plus, Smartphone, Ticket } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, cn } from "@/lib/utils";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { formatCentavos } from "@/lib/format";
import type { CartQuote, PaymentMethod } from "@/lib/types/domain";

interface AddressOption {
  id: string;
  label: string;
  line1: string;
  barangay: string | null;
  city: string | null;
  is_default: boolean;
}

const TIP_PRESETS_CENTAVOS = [0, 2000, 3000, 5000];

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: "cod", label: "Cash on delivery", icon: Banknote },
  { value: "gcash", label: "GCash", icon: Smartphone },
  { value: "maya", label: "Maya", icon: Smartphone },
  { value: "card", label: "Card", icon: CreditCard },
];

export function CheckoutForm({
  cartId,
  addresses,
  initialAddressId,
  initialQuote,
}: {
  cartId: string;
  addresses: AddressOption[];
  initialAddressId: string | null;
  initialQuote: CartQuote | null;
}) {
  const router = useRouter();

  const [addressId, setAddressId] = React.useState(initialAddressId);
  const [promoCode, setPromoCode] = React.useState("");
  const [tipCentavos, setTipCentavos] = React.useState(0);
  const [notes, setNotes] = React.useState("");
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>("cod");

  const [quote, setQuote] = React.useState(initialQuote);
  const [quoting, setQuoting] = React.useState(false);
  const [placing, setPlacing] = React.useState(false);
  const [placeError, setPlaceError] = React.useState<string | null>(null);

  // Re-quote from the server on every change that affects the total. This is
  // the same price_cart call place_order makes internally, so the number on
  // screen is never a client-side estimate of what will be charged.
  React.useEffect(() => {
    const supabase = createClient();
    const timer = window.setTimeout(async () => {
      setQuoting(true);
      const { data } = await supabase.rpc("price_cart", {
        p_cart_id: cartId,
        p_address_id: addressId,
        p_promo_code: promoCode.trim() || null,
        p_tip_centavos: tipCentavos,
        p_order_type: "delivery",
      });
      setQuote(data as CartQuote | null);
      setQuoting(false);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [cartId, addressId, promoCode, tipCentavos]);

  const promoError = quote?.errors?.find((e) => e.code === "promo_invalid");
  const otherErrors = quote?.errors?.filter((e) => e.code !== "promo_invalid") ?? [];
  const promoApplied = Boolean(quote?.promo_code) && quote!.discount_centavos > 0;
  const canPlace = Boolean(quote?.is_valid) && addressId && !placing;

  async function handlePlaceOrder() {
    if (!canPlace) return;
    setPlacing(true);
    setPlaceError(null);

    const supabase = createClient();
    const { data: orderId, error } = await supabase.rpc("place_order", {
      p_cart_id: cartId,
      p_address_id: addressId,
      p_payment_method: paymentMethod,
      p_promo_code: promoCode.trim() || null,
      p_tip_centavos: tipCentavos,
      p_order_type: "delivery",
      p_customer_notes: notes.trim() || null,
      p_scheduled_for: null,
    });

    if (error || !orderId) {
      setPlaceError(friendlyError(error));
      setPlacing(false);
      return;
    }

    if (paymentMethod === "cod") {
      router.push(`/orders/${orderId}`);
      return;
    }

    // Order exists in 'pending_payment' the moment place_order returns -
    // this call only starts the PayMongo checkout for it, exactly what
    // create-checkout/route.ts also does when retried from the tracking page.
    const res = await fetch("/api/payments/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const payload = await res.json().catch(() => null);

    if (!res.ok || !payload?.checkoutUrl) {
      // The order already exists and can be retried from its own tracking
      // page, so send them there rather than stranding them on checkout.
      router.push(`/orders/${orderId}`);
      return;
    }

    window.location.href = payload.checkoutUrl;
  }

  return (
    <div className="space-y-6 px-5 pt-1 pb-56">
      <section aria-labelledby="address-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="address-heading" className="text-[15px] font-bold">
            Deliver to
          </h2>
          {addresses.length > 0 && (
            <LinkButton href="/account/addresses/new?next=/checkout" size="sm" variant="secondary">
              <Plus aria-hidden className="size-3.5" /> Add
            </LinkButton>
          )}
        </div>

        {addresses.length === 0 ? (
          <div className="rounded-[18px] border-2 border-line-warm bg-card p-4">
            <p className="text-sm font-semibold">No saved addresses</p>
            <p className="mt-0.5 mb-3 text-sm text-fg-muted">
              Add one to see your delivery fee and place this order.
            </p>
            <LinkButton href="/account/addresses/new?next=/checkout" size="sm">
              Add address
            </LinkButton>
          </div>
        ) : (
          <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1">
            {addresses.map((a) => {
              const active = addressId === a.id;
              return (
                <label key={a.id} className="w-55 shrink-0 snap-start">
                  <div
                    className={cn(
                      "h-full cursor-pointer rounded-[18px] border-2 bg-card p-3.5 transition-colors",
                      active ? "border-primary bg-coral-tint" : "border-line-warm",
                    )}
                  >
                    <input
                      type="radio"
                      name="address"
                      value={a.id}
                      checked={active}
                      onChange={() => setAddressId(a.id)}
                      className="sr-only"
                    />
                    <MapPin aria-hidden className={cn("size-4.5", active ? "text-primary" : "text-fg-muted")} />
                    <p className="mt-2 truncate text-sm font-bold">{a.label}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">
                      {[a.line1, a.barangay, a.city].filter(Boolean).join(", ")}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="payment-heading">
        <h2 id="payment-heading" className="mb-3 text-[15px] font-bold">
          Payment
        </h2>
        <div className="grid grid-cols-2 gap-2.5">
          {PAYMENT_METHODS.map((m) => {
            const active = paymentMethod === m.value;
            const Icon = m.icon;
            return (
              <label key={m.value}>
                <div
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-[18px] border-2 bg-card p-3 transition-colors",
                    active ? "border-primary bg-coral-tint" : "border-line-warm",
                  )}
                >
                  <input
                    type="radio"
                    name="payment-method"
                    value={m.value}
                    checked={active}
                    onChange={() => setPaymentMethod(m.value)}
                    className="sr-only"
                  />
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-full",
                      active ? "bg-primary text-primary-fg" : "bg-cream text-fg-muted",
                    )}
                  >
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <span className="min-w-0 truncate text-[13px] font-bold">{m.label}</span>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="tip-heading">
        <h2 id="tip-heading" className="mb-3 text-[15px] font-bold">
          Add a tip for your rider
        </h2>
        <div className="grid grid-cols-4 gap-2">
          {TIP_PRESETS_CENTAVOS.map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => setTipCentavos(amount)}
              aria-pressed={tipCentavos === amount}
              className={cn(
                "rounded-xl py-2.5 text-center text-[13px] font-bold transition-colors",
                tipCentavos === amount ? "bg-fg text-white" : "bg-neutral-chip text-fg",
              )}
            >
              {amount === 0 ? "No tip" : formatCentavos(amount)}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="promo-heading">
        <h2 id="promo-heading" className="mb-3 text-[15px] font-bold">
          Promo code
        </h2>
        <div className="relative">
          <Ticket
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
          />
          <Input
            aria-label="Promo code"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
            placeholder="WELCOME50"
            className="pl-9"
            invalid={Boolean(promoError)}
          />
        </div>
        {promoError && <p className="mt-1.5 text-xs font-medium text-danger">{promoError.message}</p>}
        {promoApplied && (
          <span className="mt-2 inline-flex items-center gap-1 rounded-pill bg-mint-tint px-2.5 py-1 text-xs font-bold text-accent-fg">
            {quote!.promo_code} applied — you saved {formatCentavos(quote!.discount_centavos)}
          </span>
        )}
      </section>

      <section aria-labelledby="notes-heading">
        <h2 id="notes-heading" className="mb-3 text-[15px] font-bold">
          Notes for your rider <span className="font-normal text-fg-muted">(optional)</span>
        </h2>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. gate code, which floor, landmark"
        />
      </section>

      {otherErrors.map((e) => (
        <p key={e.code} role="alert" className="rounded-2xl bg-warning-tint px-4 py-3 text-sm font-medium text-warning">
          {e.message}
        </p>
      ))}

      {quote && (
        <div className="rounded-[20px] bg-card px-4 py-1 shadow-card">
          <Row label="Subtotal" value={formatCentavos(quote.subtotal_centavos)} />
          <Row label="Delivery" value={formatCentavos(quote.delivery_fee_centavos)} />
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
          {tipCentavos > 0 && <Row label="Tip" value={formatCentavos(tipCentavos)} />}
          <Row label="Total" value={quoting ? "…" : formatCentavos(quote.total_centavos)} strong />
        </div>
      )}

      {placeError && (
        <p role="alert" className="rounded-2xl bg-danger-tint px-4 py-3 text-sm text-danger">
          {placeError}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-[28px] bg-card px-5 pt-4 pb-7.5 shadow-[0_-8px_24px_rgb(122_58_31/0.08)]">
        <p className="mb-2 text-center text-xs text-fg-muted">
          {quote
            ? tipCentavos > 0
              ? `Total incl. ${formatCentavos(tipCentavos)} tip: ${formatCentavos(quote.total_centavos)}`
              : `Total: ${formatCentavos(quote.total_centavos)}`
            : paymentMethod === "cod"
              ? "You will pay cash on delivery when your order arrives."
              : "You'll finish payment on PayMongo's secure page, then come back here."}
        </p>
        <Button size="lg" fullWidth onClick={handlePlaceOrder} loading={placing} disabled={!canPlace}>
          {paymentMethod === "cod" ? "Place order" : "Continue to payment"}
        </Button>
      </div>
    </div>
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
