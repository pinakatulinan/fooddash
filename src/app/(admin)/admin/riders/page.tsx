import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DataTable, StatRow } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/status-pill";
import { formatCentavos, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Riders" };

export default async function AdminRidersPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("riders")
    .select(
      `id, vehicle, plate_number, status, is_verified, is_suspended,
       cash_on_hand_centavos, completed_deliveries, rating_avg, rating_count, last_ping_at,
       profiles!riders_id_fkey(full_name, phone)`,
    )
    .order("created_at", { ascending: false });

  const riders = (data ?? []) as unknown as {
    id: string;
    vehicle: string;
    plate_number: string | null;
    status: string;
    is_verified: boolean;
    is_suspended: boolean;
    cash_on_hand_centavos: number;
    completed_deliveries: number;
    rating_avg: number;
    rating_count: number;
    last_ping_at: string | null;
    profiles: { full_name: string | null; phone: string | null } | null;
  }[];

  const online = riders.filter((r) => r.status !== "offline").length;
  const unverified = riders.filter((r) => !r.is_verified).length;
  const cashHeld = riders.reduce((s, r) => s + r.cash_on_hand_centavos, 0);

  return (
    <>
      <ScreenHeader title="Riders" subtitle={`${riders.length} total`} />

      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        {error && (
          <p role="alert" className="rounded-md bg-danger-tint px-4 py-3 text-sm text-danger">
            Could not load riders: {error.message}
          </p>
        )}

        <StatRow
          stats={[
            { label: "Riders", value: String(riders.length) },
            { label: "Online", value: String(online) },
            {
              label: "Awaiting verification",
              value: String(unverified),
              tone: unverified ? "warn" : "normal",
            },
            // Cash the platform is owed, sitting in riders' pockets.
            { label: "Cash outstanding", value: formatCentavos(cashHeld) },
          ]}
        />

        <DataTable
          columns={[
            { key: "name", label: "Rider" },
            { key: "state", label: "State" },
            { key: "vehicle", label: "Vehicle", hideOnMobile: true },
            { key: "seen", label: "Last ping", hideOnMobile: true },
            { key: "trips", label: "Trips", align: "right", mono: true, hideOnMobile: true },
            { key: "cash", label: "Cash held", align: "right", mono: true },
          ]}
          rows={riders.map((r) => ({
            name: (
              <div>
                <span className="font-bold">{r.profiles?.full_name ?? "—"}</span>
                {!r.is_verified && <span className="ml-2 text-xs text-warning">unverified</span>}
                {r.is_suspended && <span className="ml-2 text-xs text-danger">suspended</span>}
              </div>
            ),
            state: (
              <Pill tone={r.status === "offline" ? "neutral" : "success"}>
                {r.status.replace(/_/g, " ")}
              </Pill>
            ),
            vehicle: `${r.vehicle.replace(/_/g, " ")}${r.plate_number ? ` · ${r.plate_number}` : ""}`,
            seen: r.last_ping_at ? formatRelative(r.last_ping_at) : "never",
            trips: String(r.completed_deliveries),
            cash: formatCentavos(r.cash_on_hand_centavos),
          }))}
          empty="No riders yet"
        />
      </div>
    </>
  );
}
