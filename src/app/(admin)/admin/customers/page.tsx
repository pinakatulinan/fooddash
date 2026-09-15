import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DataTable, StatRow } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/status-pill";
import { displayPhone, formatManilaDate } from "@/lib/format";
import type { UserRole } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Customers" };

export default async function AdminCustomersPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  // profiles has no cross-user read policy except for admins — see 0009.
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, role, is_blocked, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const people = (data ?? []) as {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    role: UserRole;
    is_blocked: boolean;
    created_at: string;
  }[];

  const count = (role: UserRole) => people.filter((p) => p.role === role).length;

  return (
    <>
      <ScreenHeader title="People" subtitle={`${people.length} accounts`} />

      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        <StatRow
          stats={[
            { label: "Customers", value: String(count("customer")) },
            { label: "Merchants", value: String(count("merchant")) },
            { label: "Riders", value: String(count("rider")) },
            {
              label: "Blocked",
              value: String(people.filter((p) => p.is_blocked).length),
              tone: people.some((p) => p.is_blocked) ? "warn" : "normal",
            },
          ]}
        />

        <DataTable
          columns={[
            { key: "name", label: "Name" },
            { key: "role", label: "Role" },
            { key: "email", label: "Email", hideOnMobile: true },
            { key: "phone", label: "Mobile", mono: true, hideOnMobile: true },
            { key: "joined", label: "Joined", align: "right", hideOnMobile: true },
          ]}
          rows={people.map((p) => ({
            name: (
              <div>
                <span className="font-bold">{p.full_name ?? "—"}</span>
                {p.is_blocked && <span className="ml-2 text-xs text-danger">blocked</span>}
              </div>
            ),
            role: <Pill tone={p.role === "admin" ? "active" : "neutral"}>{p.role}</Pill>,
            email: p.email,
            phone: displayPhone(p.phone),
            joined: formatManilaDate(p.created_at),
          }))}
          empty="No accounts yet"
        />
      </div>
    </>
  );
}
