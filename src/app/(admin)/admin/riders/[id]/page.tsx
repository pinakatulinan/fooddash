import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/status-pill";
import {
  ReviewDocumentButtons,
  VerifyRiderButton,
  SuspendRiderControl,
  UnsuspendRiderButton,
} from "@/components/admin/rider-review-controls";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { DOC_INFO, PAYOUT_METHODS, VEHICLE_LABELS, requiredDocuments, type RiderDocType } from "@/lib/domain/rider-documents";
import { displayPhone, formatManilaDate, formatRelative } from "@/lib/format";
import type { VehicleType } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Rider application" };

const STATUS_TONE = { pending: "active", approved: "success", rejected: "danger", expired: "danger" } as const;
const STATUS_LABEL = { pending: "In review", approved: "Approved", rejected: "Rejected", expired: "Expired" } as const;

export default async function AdminRiderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { id } = await params;
  const { profile } = await getCurrentUser();
  // The service-role client below bypasses RLS, so the role check happens
  // here rather than being assumed from the /admin route guard.
  if (profile?.role !== "admin" && profile?.role !== "support") redirect("/");

  const supabase = await createClient();
  const { data: rider } = await supabase
    .from("riders")
    .select(
      "id, vehicle, plate_number, home_zone_id, is_verified, verified_at, is_suspended, created_at, profiles!riders_id_fkey(full_name, phone, email)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!rider) notFound();

  const [{ data: application }, { data: documents }, { data: zone }] = await Promise.all([
    supabase
      .from("rider_applications")
      .select(
        "date_of_birth, address_line1, barangay, city, emergency_contact_name, emergency_contact_phone, payout_method, payout_account_name, submitted_at",
      )
      .eq("rider_id", id)
      .maybeSingle(),
    supabase
      .from("rider_documents")
      .select("id, doc_type, storage_path, status, review_note, expires_at, created_at")
      .eq("rider_id", id)
      .order("created_at", { ascending: false }),
    rider.home_zone_id
      ? supabase.from("service_zones").select("name").eq("id", rider.home_zone_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // payout_account_number is encrypted at rest (0023) - the plaintext only
  // ever comes back through this admin-gated RPC, never off the raw column.
  const { data: payoutAccountNumber } = application
    ? await supabase.rpc("decrypt_rider_payout_account", { p_rider_id: id })
    : { data: null };

  const who = rider.profiles as unknown as { full_name: string | null; phone: string | null; email: string | null } | null;
  const vehicle = rider.vehicle as VehicleType;
  const required = requiredDocuments(vehicle);
  const docs = documents ?? [];

  // The bucket is private. Short-lived signed links, minted only after the
  // role check above.
  const admin = createAdminClient();
  const signed = new Map<string, string>();
  await Promise.all(
    docs.map(async (d) => {
      const { data } = await admin.storage.from("documents").createSignedUrl(d.storage_path, 600);
      if (data?.signedUrl) signed.set(d.id, data.signedUrl);
    }),
  );

  const latest = (type: string) => docs.find((d) => d.doc_type === type);
  const allApproved = required.every((t) => latest(t)?.status === "approved");
  const payoutLabel = PAYOUT_METHODS.find((m) => m.value === application?.payout_method)?.label;

  // Anything uploaded that this vehicle does not actually need (a licence
  // from a bicycle rider) - shown so it is not silently ignored.
  const extraTypes = [...new Set(docs.map((d) => d.doc_type))].filter((t) => !required.includes(t as RiderDocType));

  return (
    <>
      <RealtimeRefresh table="rider_documents" filter={`rider_id=eq.${id}`} />

      <ScreenHeader
        title={who?.full_name ?? "Rider"}
        subtitle={rider.is_verified ? `Verified ${formatManilaDate(rider.verified_at)}` : "Awaiting verification"}
        backHref="/admin/riders"
        actions={
          rider.is_suspended ? (
            <Pill tone="danger">Suspended</Pill>
          ) : (
            <Pill tone={rider.is_verified ? "success" : "active"}>{rider.is_verified ? "Verified" : "Unverified"}</Pill>
          )
        }
      />

      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6">
        <section aria-labelledby="details">
          <h2 id="details" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">Application</h2>
          {!application ? (
            <Card>
              <p className="p-4 text-sm text-fg-muted">This rider has not submitted an application (added before onboarding existed).</p>
            </Card>
          ) : (
            <Card>
              <dl className="divide-y divide-line text-sm">
                <Row label="Contact" value={`${displayPhone(who?.phone)}${who?.email ? ` · ${who.email}` : ""}`} />
                <Row label="Vehicle" value={`${VEHICLE_LABELS[vehicle]}${rider.plate_number ? ` · ${rider.plate_number}` : ""}`} />
                <Row label="Zone" value={zone?.name ?? "—"} />
                <Row label="Date of birth" value={formatManilaDate(application.date_of_birth)} />
                <Row
                  label="Address"
                  value={[application.address_line1, application.barangay, application.city].filter(Boolean).join(", ")}
                />
                <Row
                  label="Emergency contact"
                  value={`${application.emergency_contact_name} · ${displayPhone(application.emergency_contact_phone)}`}
                />
                <Row
                  label="Payout"
                  value={`${payoutLabel ?? application.payout_method} · ${application.payout_account_name} · ${payoutAccountNumber ?? "—"}`}
                />
                <Row label="Submitted" value={formatRelative(application.submitted_at)} />
              </dl>
            </Card>
          )}
        </section>

        <section aria-labelledby="docs">
          <h2 id="docs" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">Documents</h2>
          <ul className="space-y-2">
            {[...required, ...extraTypes].map((type) => {
              const doc = latest(type);
              const info = DOC_INFO[type as RiderDocType];
              return (
                <li key={type}>
                  <Card>
                    <div className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold">{info?.label ?? type}</p>
                          {doc?.expires_at && (
                            <p className="mt-0.5 text-xs text-fg-muted">Expires {formatManilaDate(doc.expires_at)}</p>
                          )}
                        </div>
                        {doc ? (
                          <Pill tone={STATUS_TONE[doc.status as keyof typeof STATUS_TONE]}>
                            {STATUS_LABEL[doc.status as keyof typeof STATUS_LABEL]}
                          </Pill>
                        ) : (
                          <Pill tone="neutral">Not uploaded</Pill>
                        )}
                      </div>

                      {doc && signed.get(doc.id) && (
                        <a
                          href={signed.get(doc.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
                        >
                          <ExternalLink aria-hidden className="size-4" /> Open file
                        </a>
                      )}

                      {doc?.status === "rejected" && doc.review_note && (
                        <p className="text-sm text-fg-muted">Rejected: {doc.review_note}</p>
                      )}

                      {doc && doc.status !== "approved" && <ReviewDocumentButtons documentId={doc.id} />}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>

        {!rider.is_verified && (
          <section aria-labelledby="verify" className="space-y-2">
            <h2 id="verify" className="text-sm font-bold tracking-wide text-fg-muted uppercase">Decision</h2>
            <p className="text-sm text-fg-muted">
              {allApproved && application
                ? "Everything required is approved. Verifying lets this rider go online and receive jobs."
                : "Approve every required document (and have an application on file) before verifying."}
            </p>
            <VerifyRiderButton riderId={id} disabled={!allApproved || !application} />
          </section>
        )}

        {rider.is_verified && !rider.is_suspended && (
          <section aria-labelledby="suspend" className="space-y-2">
            <h2 id="suspend" className="text-sm font-bold tracking-wide text-fg-muted uppercase">Suspend</h2>
            <SuspendRiderControl riderId={id} />
          </section>
        )}

        {rider.is_suspended && (
          <section aria-labelledby="suspended" className="space-y-2">
            <h2 id="suspended" className="text-sm font-bold tracking-wide text-fg-muted uppercase">Suspended</h2>
            <p className="text-sm text-fg-muted">This rider cannot go online while suspended.</p>
            <UnsuspendRiderButton riderId={id} />
          </section>
        )}
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="shrink-0 text-fg-muted">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}
