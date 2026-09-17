"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { formatRelative } from "@/lib/format";

interface Message {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

/**
 * A direct channel between a customer and whoever is actually carrying
 * their order - separate from `support_messages`, which is a staff-facing
 * ticket thread. Shared between the customer's order page and the rider's
 * active-delivery page; each side passes its own `currentUserId` so bubbles
 * align right for whoever is looking.
 *
 * Live updates go through the same full-refresh RealtimeRefresh pattern as
 * the rest of the app (see its own doc comment) rather than a second,
 * bespoke incremental-merge path - the parent Server Component re-fetches
 * `messages` and this just re-renders with the new prop.
 *
 * `canSend` is a UI nicety, not the access boundary: `order_messages_write`
 * (0013) is the real gate, restricted to while a rider actually has this
 * order 'accepted'. Hiding the form once that is no longer true just avoids
 * a confusing failed-send instead of leaving it to the RLS error.
 */
export function OrderChat({
  orderId,
  currentUserId,
  messages,
  canSend,
}: {
  orderId: string;
  currentUserId: string;
  messages: Message[];
  canSend: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;

    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("order_messages")
      .insert({ order_id: orderId, sender_id: currentUserId, body: text });
    setSubmitting(false);

    if (insertError) {
      setError(friendlyError(insertError));
      return;
    }
    setBody("");
    router.refresh();
  }

  return (
    <Card>
      <RealtimeRefresh table="order_messages" filter={`order_id=eq.${orderId}`} />
      <div className="p-4">
        <p className="mb-3 flex items-center gap-2 text-xs font-bold tracking-wide text-fg-muted uppercase">
          <MessageCircle aria-hidden className="size-3.5" /> Chat
        </p>

        {messages.length === 0 ? (
          <p className="py-3 text-center text-sm text-fg-muted">No messages yet — say hello.</p>
        ) : (
          <ul ref={listRef} className="max-h-64 space-y-2 overflow-y-auto">
            {messages.map((m) => (
              <li key={m.id} className={m.sender_id === currentUserId ? "text-right" : ""}>
                <div
                  className={`inline-block max-w-[85%] rounded-md px-3 py-2 text-left text-sm ${
                    m.sender_id === currentUserId ? "bg-primary text-primary-fg" : "bg-surface-raised"
                  }`}
                >
                  {m.body}
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">{formatRelative(m.created_at)}</p>
              </li>
            ))}
          </ul>
        )}

        {canSend ? (
          <form onSubmit={send} className="mt-3 flex gap-2 border-t border-line pt-3">
            <Textarea
              aria-label="Message"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={1}
              placeholder="Type a message..."
              className="min-h-11 flex-1"
            />
            <Button type="submit" size="sm" loading={submitting} disabled={!body.trim()}>
              Send
            </Button>
          </form>
        ) : (
          messages.length > 0 && (
            <p className="mt-3 border-t border-line pt-3 text-xs text-fg-muted">
              This chat closed when the delivery ended.
            </p>
          )
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
