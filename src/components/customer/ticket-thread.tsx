"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/input";
import { formatRelative } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};
const STATUS_TONE: Record<string, "active" | "success" | "neutral"> = {
  open: "active",
  in_progress: "active",
  resolved: "success",
  closed: "neutral",
};

interface Message {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
}

interface Ticket {
  id: string;
  category: string;
  subject: string;
  body: string | null;
  status: string;
  resolution: string | null;
  created_at: string;
  messages: Message[];
}

/**
 * A customer's own view of one ticket - the initial report, the reply
 * thread, and a box to add to it. is_internal messages never reach this
 * component at all: support_messages_read (0009) filters them out at the
 * database before this ever runs, not something rendered around here.
 */
export function TicketThread({ ticket, customerId }: { ticket: Ticket; customerId: string }) {
  const router = useRouter();
  const [reply, setReply] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;

    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("support_messages").insert({
      ticket_id: ticket.id,
      author_id: customerId,
      body: reply.trim(),
      is_internal: false,
    });
    setSubmitting(false);

    if (insertError) {
      setError(friendlyError(insertError));
      return;
    }
    setReply("");
    router.refresh();
  }

  return (
    <Card>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold">{ticket.subject}</p>
            <p className="text-xs text-fg-muted">{formatRelative(ticket.created_at)}</p>
          </div>
          <Pill tone={STATUS_TONE[ticket.status] ?? "neutral"}>{STATUS_LABEL[ticket.status] ?? ticket.status}</Pill>
        </div>

        {ticket.body && <p className="text-sm text-fg-muted">{ticket.body}</p>}

        {ticket.messages.length > 0 && (
          <ul className="space-y-2 border-t border-line pt-3">
            {ticket.messages.map((m) => (
              <li key={m.id} className={m.author_id === customerId ? "text-right" : ""}>
                <div
                  className={`inline-block max-w-[85%] rounded-md px-3 py-2 text-left text-sm ${
                    m.author_id === customerId ? "bg-primary text-primary-fg" : "bg-surface-raised"
                  }`}
                >
                  {m.body}
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">{formatRelative(m.created_at)}</p>
              </li>
            ))}
          </ul>
        )}

        {ticket.status === "resolved" && ticket.resolution && (
          <div className="rounded-md border border-accent bg-accent/10 p-3">
            <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Resolution</p>
            <p className="mt-1 text-sm">{ticket.resolution}</p>
          </div>
        )}

        {ticket.status !== "closed" && (
          <form onSubmit={sendReply} className="flex gap-2 border-t border-line pt-3">
            <Textarea
              aria-label="Add a reply"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={1}
              placeholder="Add more detail..."
              className="min-h-11 flex-1"
            />
            <Button type="submit" size="sm" loading={submitting} disabled={!reply.trim()}>
              Send
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
