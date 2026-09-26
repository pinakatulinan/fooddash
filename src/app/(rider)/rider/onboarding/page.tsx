import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClipboardCheck, Hourglass } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card } from "@/components/ui/card";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { RiderApplicationForm } from "@/components/rider/application-form";
import { DocumentChecklist, type RiderDocument } from "@/components/rider/document-checklist";
import { requiredDocuments } from "@/lib/domain/rider-documents";
import { latestAdultBirthdateISO, manilaTodayISO } from "@/lib/format";
import type { VehicleType } from "@/lib/types/domain";

export const metadata: Metadata = { title: "Rider application" };

/**
 * Two states on one page, keyed off whether a riders row exists yet:
 *
 *   no row  -> the application form. Submitting calls submit_rider_application,
 *              which is the only thing that can create the row (unverified).
 *   a row   -> the document checklist plus an editable copy of the details,
 *              until ops verify them; then this page sends them to /rider.
 *
 * Documents come second because rider_documents.rider_id references riders(id):
 * there is nothing to attach a file to until the row exists.
 */
export default async function RiderOnboardingPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { user, profile } = await getCurrentUser();
  if (!user) redirect("/login?next=/rider/onboarding");
  if (profile?.role !== "rider") redirect("/");

  const supabase = await createClient();

  const [{ data: rider }, { data: application }, { data: documents }, { data: zones }] = await Promise.all([
    supabase.from("riders").select("id, vehicle, plate_number, home_zone_id, is_verified").eq("id", user.id).maybeSingle(),
    supabase
      .from("rider_applications")
      .select(
        "date_of_birth, address_line1, barangay, city, emergency_contact_name, emergency_contact_phone, payout_method, payout_account_name",
      )
      .eq("rider_id", user.id)
      .maybeSingle(),
    supabase
      .from("rider_documents")
      .select("id, doc_type, storage_path, status, review_note, expires_at, created_at")
      .eq("rider_id", user.id),
    supabase.from("service_zones").select("id, name").eq("is_active", true).order("name"),
  ]);

  // payout_account_number is encrypted at rest (0023) - only fetched once an
  // application actually exists, since decrypt_rider_payout_account has
  // nothing to decrypt otherwise.
  const { data: payoutAccountNumber } = application
    ? await supabase.rpc("decrypt_rider_payout_account", { p_rider_id: user.id })
    : { data: null };

  if (rider?.is_verified) redirect("/rider");

  const maxDob = latestAdultBirthdateISO();
  const zoneList = zones ?? [];

  if (!rider) {
    return (
      <>
        <ScreenHeader title="Become a rider" subtitle="Tell us about you and your vehicle." />
        <div className="px-4 py-6">
          <RiderApplicationForm zones={zoneList} initial={null} maxDob={maxDob} submitLabel="Continue to documents" />
        </div>
      </>
    );
  }

  const docs = (documents ?? []) as RiderDocument[];
  const required = requiredDocuments(rider.vehicle as VehicleType);
  const allSubmitted = required.every((t) =>
    docs.some((d) => d.doc_type === t && (d.status === "pending" || d.status === "approved")),
  );

  return (
    <>
      <RealtimeRefresh table="rider_documents" filter={`rider_id=eq.${rider.id}`} />
      <RealtimeRefresh table="riders" filter={`id=eq.${rider.id}`} />

      <ScreenHeader
        title="Rider application"
        subtitle={allSubmitted ? "Under review" : "Upload your documents"}
      />

      <div className="space-y-8 px-4 py-6">
        <Card>
          <div className="flex items-start gap-3 p-4">
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-pill bg-accent text-accent-fg">
              {allSubmitted ? <Hourglass className="size-5" /> : <ClipboardCheck className="size-5" />}
            </span>
            <div className="min-w-0">
              <p className="font-bold">
                {allSubmitted ? "We're reviewing your documents" : "Almost there"}
              </p>
              <p className="mt-0.5 text-sm text-fg-muted">
                {allSubmitted
                  ? "This page updates by itself as ops review each one. You can go online the moment everything is approved."
                  : "Upload every document below. Ops reviews them, and you can go online once all are approved."}
              </p>
            </div>
          </div>
        </Card>

        <section aria-labelledby="docs-heading">
          <h2 id="docs-heading" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Documents
          </h2>
          <DocumentChecklist
            riderId={rider.id}
            vehicle={rider.vehicle as VehicleType}
            documents={docs}
            today={manilaTodayISO()}
          />
        </section>

        <details className="rounded-lg border border-line bg-card">
          <summary className="cursor-pointer px-4 py-3.5 text-sm font-bold">Edit your details</summary>
          <div className="border-t border-line p-4">
            <RiderApplicationForm
              zones={zoneList}
              maxDob={maxDob}
              submitLabel="Save changes"
              initial={{
                vehicle: rider.vehicle as VehicleType,
                plate_number: rider.plate_number ?? "",
                home_zone_id: rider.home_zone_id ?? undefined,
                date_of_birth: application?.date_of_birth ?? "",
                address_line1: application?.address_line1 ?? "",
                barangay: application?.barangay ?? "",
                city: application?.city ?? "",
                emergency_contact_name: application?.emergency_contact_name ?? "",
                emergency_contact_phone: application?.emergency_contact_phone ?? "",
                payout_method: application?.payout_method ?? "gcash",
                payout_account_name: application?.payout_account_name ?? "",
                payout_account_number: payoutAccountNumber ?? "",
              }}
            />
          </div>
        </details>
      </div>
    </>
  );
}
