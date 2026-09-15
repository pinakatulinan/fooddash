import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/status-pill";
import { TicketStatusControl } from "@/components/admin/ticket-status-control";
import { TicketReplyForm } from "@/components/admin/ticket-reply-form";
import { formatManilaDate, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Ticket" };

const STATUS_TONE = { open: "active", in_progress: "active", resolved: "success", closed: "neutral" } as const;

export default async function AdminTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { id } = await params;
  const supabase = await createClient();
  const { user } = await getCurrentUser();

  const { data: ticket } = await supabase
    .from("support_tickets")
    .select(
      `id, category, subject, body, status, resolution, created_at, resolved_at,
       orders(code), raiser:profiles!support_tickets_raised_by_fkey(full_name, email),
       messages:support_messages(id, author_id, body, is_internal, created_at,
                                  author:profiles!support_messages_author_id_fkey(full_name))`,
    )
    .eq("id", id)
    .order("created_at", { referencedTable: "messages", ascending: true })
    .maybeSingle();

  if (!ticket || !user) notFound();

  const t = ticket as unknown as {
    id: string;
    category: string;
    subject: string;
    body: string | null;
    status: keyof typeof STATUS_TONE;
    resolution: string | null;
    created_at: string;
    resolved_at: string | null;
    orders: { code: string } | null;
    raiser: { full_name: string | null; email: string } | null;
    messages: {
      id: string;
      author_id: string;
      body: string;
      is_internal: boolean;
      created_at: string;
      author: { full_name: string | null } | null;
    }[];
  };

  return (
    <>
      <ScreenHeader
        title={t.subject}
        subtitle={`Raised by ${t.raiser?.full_name ?? t.raiser?.email ?? "unknown"} · ${t.category.replace(/_/g, " ")}`}
        backHref="/admin/support"
        actions={<Pill tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status.replace(/_/g, " ")}</Pill>}
      />

      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
          <span>{formatManilaDate(t.created_at)}</span>
          {t.orders && (
            <Link href="/admin/orders" className="font-mono hover:underline">
              {t.orders.code}
            </Link>
          )}
          {t.resolved_at && <span>Resolved {formatRelative(t.resolved_at)}</span>}
        </div>

        {t.body && (
          <Card>
            <p className="p-4 text-sm">{t.body}</p>
          </Card>
        )}

        <TicketStatusControl ticketId={t.id} status={t.status} resolution={t.resolution} />

        {t.messages.length > 0 && (
          <section aria-labelledby="thread">
            <h2 id="thread" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
              Thread
            </h2>
            <ul className="space-y-2">
              {t.messages.map((m) => (
                <li key={m.id}>
                  <Card className={m.is_internal ? "border-warning" : undefined}>
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold">
                          {m.author?.full_name ?? "Someone"}
                          {m.is_internal && (
                            <span className="ml-1.5 text-warning">· internal note</span>
                          )}
                        </p>
                        <p className="text-xs text-fg-muted">{formatRelative(m.created_at)}</p>
                      </div>
                      <p className="mt-1 text-sm">{m.body}</p>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}

        <TicketReplyForm ticketId={t.id} authorId={user.id} />
      </div>
    </>
  );
}
