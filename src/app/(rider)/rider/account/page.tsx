import type { Metadata } from "next";
import { Bike, ShieldCheck } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { displayPhone, formatManilaDate } from "@/lib/format";
import { signOut } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Rider account" };

export default async function RiderAccountPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { user, profile } = await getCurrentUser();
  const supabase = await createClient();

  const [{ data: rider }, { data: docs }] = await Promise.all([
    supabase
      .from("riders")
      .select("vehicle, plate_number, is_verified, is_suspended, rating_avg, rating_count, completed_deliveries")
      .maybeSingle(),
    supabase.from("rider_documents").select("id, doc_type, status, expires_at"),
  ]);

  if (!rider) {
    return (
      <>
        <ScreenHeader title="Account" />
        <div className="px-4 py-5">
          <Card>
            <EmptyState
              icon={<Bike className="size-6" />}
              title="This account is not a rider"
              description="Complete rider signup to upload your licence and start receiving jobs."
            />
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <ScreenHeader
        title={profile?.full_name ?? "Rider"}
        subtitle={user?.email ?? undefined}
        actions={
          <Pill tone={rider.is_verified ? "success" : "neutral"}>
            {rider.is_suspended ? "Suspended" : rider.is_verified ? "Verified" : "Pending"}
          </Pill>
        }
      />

      <div className="space-y-6 px-4 py-5">
        <Card>
          <dl className="divide-y divide-line">
            <Row label="Mobile" value={displayPhone(profile?.phone)} />
            <Row label="Vehicle" value={rider.vehicle.replace(/_/g, " ")} />
            <Row label="Plate" value={rider.plate_number ?? "—"} />
            <Row
              label="Rating"
              value={
                rider.rating_count > 0
                  ? `${Number(rider.rating_avg).toFixed(1)} (${rider.rating_count})`
                  : "No ratings yet"
              }
            />
            <Row label="Deliveries" value={String(rider.completed_deliveries)} />
          </dl>
        </Card>

        <section aria-labelledby="docs">
          <h2 id="docs" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Documents
          </h2>
          <Card>
            {(docs ?? []).length === 0 ? (
              <div className="flex items-start gap-3 p-4">
                <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                <p className="text-sm text-fg-muted">
                  No documents uploaded. Ops needs your driver&apos;s licence, OR/CR and NBI
                  clearance before you can go online.
                </p>
              </div>
            ) : (
              <dl className="divide-y divide-line">
                {docs!.map((d) => (
                  <Row
                    key={d.id}
                    label={d.doc_type.replace(/_/g, " ")}
                    value={
                      d.expires_at ? `${d.status} · expires ${formatManilaDate(d.expires_at)}` : d.status
                    }
                  />
                ))}
              </dl>
            )}
          </Card>
        </section>

        <form action={signOut}>
          <Button type="submit" variant="secondary" fullWidth>
            Sign out
          </Button>
        </form>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="truncate text-sm font-semibold capitalize">{value}</dd>
    </div>
  );
}
