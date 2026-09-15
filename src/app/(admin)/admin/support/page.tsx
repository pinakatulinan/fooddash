import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DataTable, StatRow } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/status-pill";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Support" };

const TONE = { open: "active", in_progress: "active", resolved: "success", closed: "neutral" } as const;

export default async function AdminSupportPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const { data } = await supabase
    .from("support_tickets")
    .select("id, category, subject, status, created_at, resolved_at, orders(code)")
    .order("created_at", { ascending: false })
    .limit(100);

  const tickets = (data ?? []) as unknown as {
    id: string;
    category: string;
    subject: string;
    status: keyof typeof TONE;
    created_at: string;
    resolved_at: string | null;
    orders: { code: string } | null;
  }[];

  const openCount = tickets.filter((t) => t.status === "open").length;

  return (
    <>
      <ScreenHeader
        title="Support"
        subtitle={`${tickets.length} tickets`}
        actions={openCount > 0 ? <Pill tone="active">{openCount} open</Pill> : undefined}
      />

      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        <StatRow
          stats={[
            { label: "Open", value: String(openCount), tone: openCount ? "warn" : "normal" },
            { label: "In progress", value: String(tickets.filter((t) => t.status === "in_progress").length) },
            { label: "Resolved", value: String(tickets.filter((t) => t.status === "resolved").length) },
            { label: "Total", value: String(tickets.length) },
          ]}
        />

        <DataTable
          columns={[
            { key: "subject", label: "Subject" },
            { key: "category", label: "Category", hideOnMobile: true },
            { key: "order", label: "Order", mono: true, hideOnMobile: true },
            { key: "raised", label: "Raised", hideOnMobile: true },
            { key: "status", label: "Status", align: "right" },
          ]}
          rows={tickets.map((t) => ({
            subject: (
              <Link href={`/admin/support/${t.id}`} className="font-semibold hover:underline">
                {t.subject}
              </Link>
            ),
            category: t.category.replace(/_/g, " "),
            order: t.orders?.code,
            raised: formatRelative(t.created_at),
            status: <Pill tone={TONE[t.status] ?? "neutral"}>{t.status.replace(/_/g, " ")}</Pill>,
          }))}
          empty="No tickets"
          emptyDescription="Customers raise these from an order. Quiet is good."
        />
      </div>
    </>
  );
}
