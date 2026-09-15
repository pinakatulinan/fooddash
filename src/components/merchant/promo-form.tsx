"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";

type PromoType = "percent_off" | "fixed_off" | "free_delivery";

/**
 * Create a store-funded promo.
 *
 * funded_by/merchant_share are deliberately absent from this form and from
 * the insert it sends: a database trigger (enforce_promo_funding, 0009)
 * always forces a store-scoped promo to funded_by='merchant', merchant_share=1
 * for anyone but an admin, so there is nothing honest this form could offer
 * there anyway - a merchant cannot make the platform pay for their own promo.
 */
export function PromoForm({ merchantId, onDone }: { merchantId: string; onDone: () => void }) {
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<PromoType>("percent_off");
  const [value, setValue] = React.useState("");
  const [maxDiscount, setMaxDiscount] = React.useState("");
  const [minOrder, setMinOrder] = React.useState("");
  const [endsAt, setEndsAt] = React.useState("");
  const [usageLimit, setUsageLimit] = React.useState("");
  const [perUserLimit, setPerUserLimit] = React.useState("1");
  const [firstOrderOnly, setFirstOrderOnly] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) {
      setError("Give the promo a code.");
      return;
    }
    const numericValue = type === "free_delivery" ? 0 : parseFloat(value || "0");
    if (type !== "free_delivery" && (!Number.isFinite(numericValue) || numericValue <= 0)) {
      setError(type === "percent_off" ? "Enter a percentage above 0." : "Enter an amount above ₱0.");
      return;
    }
    if (type === "percent_off" && numericValue > 100) {
      setError("A percentage discount can't exceed 100%.");
      return;
    }

    setSubmitting(true);
    setError(null);
    const supabase = createClient();

    const { error: insertError } = await supabase.from("promos").insert({
      merchant_id: merchantId,
      code: code.trim().toUpperCase(),
      description: description.trim() || null,
      type,
      value: numericValue,
      max_discount_centavos: maxDiscount ? Math.round(parseFloat(maxDiscount) * 100) : null,
      min_order_centavos: minOrder ? Math.round(parseFloat(minOrder) * 100) : 0,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      usage_limit: usageLimit ? Number(usageLimit) : null,
      per_user_limit: Number(perUserLimit) || 1,
      first_order_only: firstOrderOnly,
    });

    setSubmitting(false);

    if (insertError) {
      setError(friendlyError(insertError));
      return;
    }

    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-line bg-surface p-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code" required hint="Customers type this at checkout.">
          {({ id }) => (
            <Input
              id={id}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="RICE20"
              className="font-mono"
              required
            />
          )}
        </Field>
        <Field label="Type">
          {({ id }) => (
            <select
              id={id}
              value={type}
              onChange={(e) => setType(e.target.value as PromoType)}
              className="h-11 w-full rounded-md border border-line bg-card px-3 text-base"
            >
              <option value="percent_off">% off</option>
              <option value="fixed_off">₱ off</option>
              <option value="free_delivery">Free delivery</option>
            </select>
          )}
        </Field>
      </div>

      <Field label="Description" hint="Optional - shown wherever the promo is advertised.">
        {({ id }) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />}
      </Field>

      {type !== "free_delivery" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={type === "percent_off" ? "Percent off" : "Amount off (₱)"} required>
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min="0"
                step={type === "percent_off" ? "1" : "0.01"}
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            )}
          </Field>
          {type === "percent_off" && (
            <Field label="Max discount (₱)" hint="Optional cap.">
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min="0"
                  step="0.01"
                  value={maxDiscount}
                  onChange={(e) => setMaxDiscount(e.target.value)}
                />
              )}
            </Field>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Minimum order (₱)" hint="Optional.">
          {({ id }) => (
            <Input id={id} type="number" min="0" step="0.01" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
          )}
        </Field>
        <Field label="Ends" hint="Optional - blank means no end date.">
          {({ id }) => (
            <Input id={id} type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          )}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Total use limit" hint="Optional - blank means unlimited.">
          {({ id }) => (
            <Input id={id} type="number" min="1" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} />
          )}
        </Field>
        <Field label="Uses per customer">
          {({ id }) => (
            <Input
              id={id}
              type="number"
              min="1"
              value={perUserLimit}
              onChange={(e) => setPerUserLimit(e.target.value)}
            />
          )}
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={firstOrderOnly}
          onChange={(e) => setFirstOrderOnly(e.target.checked)}
          className="size-4"
        />
        First order only
      </label>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2 border-t border-line pt-4">
        <Button type="submit" loading={submitting} className="flex-1">
          Create promo
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
