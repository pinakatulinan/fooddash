"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

/**
 * Turns a signed-in merchant-role account with no store yet into one with a
 * real, draft-status store - the account side of signup already offers
 * "List my store" as a role, but nothing ever called create_merchant() to
 * back it, so anyone who picked it landed here permanently stuck.
 */
export function CreateStoreForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [city, setCity] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give your store a name.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("create_merchant", {
      p_name: name.trim(),
      p_phone: phone.trim() || null,
      p_city: city.trim() || null,
    });

    setSubmitting(false);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }

    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-md space-y-4 px-4 py-6">
      <div className="rounded-md border border-line bg-surface p-4">
        <p className="text-sm text-fg-muted">
          This creates your store record. Ops reviews it before it appears to customers, and
          you can fill in the rest - hours, address, documents - from Settings once it exists.
        </p>
      </div>

      <Field label="Store name" required>
        {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}
      </Field>

      <Field label="Phone" hint="Optional - customers see this once you're approved.">
        {({ id }) => (
          <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        )}
      </Field>

      <Field label="City" hint="Optional - helps ops route your review.">
        {({ id }) => <Input id={id} value={city} onChange={(e) => setCity(e.target.value)} />}
      </Field>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" fullWidth loading={submitting}>
        Create my store
      </Button>
    </form>
  );
}
