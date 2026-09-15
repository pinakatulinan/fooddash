"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

function StarPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold">{label}</p>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => onChange(n)}
            className="p-1"
          >
            <Star
              className={cn("size-7", n <= value ? "fill-current text-primary" : "text-line")}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Submitted once, right on the tracking screen, the moment an order finishes.
 * merchant_id/rider_id are never part of the payload - a database trigger
 * (0009) resolves both from the order itself, so there is nothing here for a
 * client to get wrong or fake.
 */
export function RateOrderForm({
  orderId,
  customerId,
  hasRider,
}: {
  orderId: string;
  customerId: string;
  hasRider: boolean;
}) {
  const router = useRouter();
  const [merchantRating, setMerchantRating] = React.useState(0);
  const [riderRating, setRiderRating] = React.useState(0);
  const [comment, setComment] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (merchantRating === 0) {
      setError("Rate the store to continue.");
      return;
    }

    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("reviews").insert({
      order_id: orderId,
      customer_id: customerId,
      merchant_rating: merchantRating,
      rider_rating: hasRider && riderRating > 0 ? riderRating : null,
      comment: comment.trim() || null,
    });
    setSubmitting(false);

    if (insertError) {
      setError(friendlyError(insertError));
      return;
    }

    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-line bg-surface p-4">
      <p className="font-bold">How was your order?</p>

      <StarPicker label="The store" value={merchantRating} onChange={setMerchantRating} />
      {hasRider && <StarPicker label="Your rider" value={riderRating} onChange={setRiderRating} />}

      <div>
        <label htmlFor="review-comment" className="mb-1.5 block text-sm font-semibold">
          Anything else? (optional)
        </label>
        <Textarea
          id="review-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder="What stood out, good or bad?"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <Button type="submit" fullWidth loading={submitting}>
        Submit rating
      </Button>
    </form>
  );
}
