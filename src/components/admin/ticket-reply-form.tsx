"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

export function TicketReplyForm({ ticketId, authorId }: { ticketId: string; authorId: string }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [isInternal, setIsInternal] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;

    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("support_messages").insert({
      ticket_id: ticketId,
      author_id: authorId,
      body: body.trim(),
      is_internal: isInternal,
    });
    setSubmitting(false);

    if (insertError) {
      setError(friendlyError(insertError));
      return;
    }
    setBody("");
    router.refresh();
  }

  return (
    <form onSubmit={send} className="space-y-2 rounded-md border border-line bg-surface p-4">
      <Textarea
        aria-label="Reply"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder={isInternal ? "Internal note - not visible to the customer" : "Reply to the customer"}
      />
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={isInternal}
            onChange={(e) => setIsInternal(e.target.checked)}
            className="size-4"
          />
          Internal note (staff only)
        </label>
        <Button size="sm" type="submit" loading={submitting} disabled={!body.trim()}>
          {isInternal ? "Add note" : "Send reply"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
