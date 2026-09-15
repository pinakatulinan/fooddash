"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";

const CATEGORIES: { value: string; label: string }[] = [
  { value: "missing_item", label: "Missing item" },
  { value: "late", label: "Order arrived late" },
  { value: "wrong_order", label: "Wrong order" },
  { value: "rider_conduct", label: "Rider conduct" },
  { value: "payment", label: "Payment issue" },
];

export function ReportProblemForm({
  orderId,
  customerId,
  onDone,
}: {
  orderId: string;
  customerId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [category, setCategory] = React.useState(CATEGORIES[0].value);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim()) {
      setError("Give it a short subject.");
      return;
    }

    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("support_tickets").insert({
      order_id: orderId,
      raised_by: customerId,
      category,
      subject: subject.trim(),
      body: body.trim() || null,
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
      <Field label="What went wrong?">
        {({ id }) => (
          <select
            id={id}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-11 w-full rounded-md border border-line bg-card px-3 text-base"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field label="Subject" required>
        {({ id }) => (
          <Input
            id={id}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Short summary"
            required
          />
        )}
      </Field>

      <Field label="Details" hint="Optional - the more specific, the faster we can help.">
        {({ id }) => <Textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} rows={3} />}
      </Field>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} className="flex-1">
          Submit
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
