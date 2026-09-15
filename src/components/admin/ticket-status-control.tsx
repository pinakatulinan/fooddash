"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

/**
 * status/assigned_to/resolution are the only columns a support_tickets
 * update is even allowed to touch (column grants, 0009) - a category,
 * subject or body edit here would be silently dropped by Postgres, not
 * something this form needs to guard against on its own.
 */
export function TicketStatusControl({
  ticketId,
  status,
  resolution,
}: {
  ticketId: string;
  status: string;
  resolution: string | null;
}) {
  const router = useRouter();
  const [draftStatus, setDraftStatus] = React.useState(status);
  const [draftResolution, setDraftResolution] = React.useState(resolution ?? "");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const dirty = draftStatus !== status || draftResolution !== (resolution ?? "");

  async function save() {
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("support_tickets")
      .update({ status: draftStatus, resolution: draftResolution.trim() || null })
      .eq("id", ticketId);
    setSubmitting(false);

    if (updateError) {
      setError(friendlyError(updateError));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-md border border-line bg-surface p-4">
      <div>
        <label htmlFor="ticket-status" className="mb-1.5 block text-sm font-semibold">
          Status
        </label>
        <select
          id="ticket-status"
          value={draftStatus}
          onChange={(e) => setDraftStatus(e.target.value)}
          className="h-11 w-full max-w-xs rounded-md border border-line bg-card px-3 text-base"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="ticket-resolution" className="mb-1.5 block text-sm font-semibold">
          Resolution
        </label>
        <Textarea
          id="ticket-resolution"
          value={draftResolution}
          onChange={(e) => setDraftResolution(e.target.value)}
          rows={2}
          placeholder="What was done - shown to the customer once resolved."
        />
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <Button size="sm" loading={submitting} disabled={!dirty} onClick={save}>
        Save
      </Button>
    </div>
  );
}
