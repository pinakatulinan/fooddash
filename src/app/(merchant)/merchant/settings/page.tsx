import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentMerchant } from "@/lib/merchant";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/status-pill";
import { PauseStoreControl } from "@/components/merchant/pause-store-control";
import { MerchantImageUpload } from "@/components/merchant/merchant-image-upload";
import { MerchantAddressForm } from "@/components/merchant/address-form";
import { MerchantHoursEditor } from "@/components/merchant/hours-editor";
import { MerchantDocumentUpload } from "@/components/merchant/document-upload";
import { SubmitForReviewButton } from "@/components/merchant/submit-for-review-button";
import { signOut } from "@/app/(auth)/actions";
import { formatCentavos, displayPhone, manilaTodayISO } from "@/lib/format";

export const metadata: Metadata = { title: "Store settings" };

export default async function MerchantSettingsPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return (
      <>
        <ScreenHeader title="Store settings" />
        <EmptyState icon={<Settings className="size-6" />} title="No store linked to this account" />
      </>
    );
  }

  const supabase = await createClient();
  const [{ data: hours }, { data: docs }, { data: latlng }] = await Promise.all([
    supabase
      .from("merchant_hours")
      .select("day_of_week, opens_at, closes_at, closes_next_day")
      .eq("merchant_id", merchant.id)
      .order("day_of_week"),
    supabase
      .from("merchant_documents")
      .select("id, doc_type, storage_path, status, review_note, expires_at, created_at")
      .eq("merchant_id", merchant.id),
    supabase.rpc("merchant_location_latlng", { p_merchant_id: merchant.id }).maybeSingle() as unknown as Promise<{
      data: { lat: number; lng: number } | null;
    }>,
  ]);

  return (
    <>
      <ScreenHeader
        title="Store settings"
        subtitle={merchant.name}
        actions={
          <Pill tone={merchant.is_accepting_orders && !merchant.paused_until ? "success" : "danger"}>
            {merchant.is_accepting_orders && !merchant.paused_until ? "Accepting orders" : "Paused"}
          </Pill>
        }
      />

      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6">
        <PauseStoreControl
          merchantId={merchant.id}
          isAcceptingOrders={merchant.is_accepting_orders}
          pausedUntil={merchant.paused_until}
          pauseReason={merchant.pause_reason}
        />

        <section aria-labelledby="images">
          <h2 id="images" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Photos
          </h2>
          <Card>
            <div className="flex flex-col gap-4 p-4 sm:flex-row">
              <MerchantImageUpload
                merchantId={merchant.id}
                field="logo_url"
                label="Logo"
                currentUrl={merchant.logo_url}
                aspect="square"
              />
              <MerchantImageUpload
                merchantId={merchant.id}
                field="cover_url"
                label="Cover photo"
                currentUrl={merchant.cover_url}
                aspect="wide"
              />
            </div>
          </Card>
        </section>

        <Section title="Store">
          <Row label="Name" value={merchant.name} />
          <Row label="Status" value={merchant.status} />
          {(merchant.status === "rejected" || merchant.status === "suspended") && merchant.rejection_reason && (
            <Row label="Why" value={merchant.rejection_reason} />
          )}
          <Row label="Phone" value={displayPhone(merchant.phone)} />
        </Section>

        <section aria-labelledby="address">
          <h2 id="address" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">Address</h2>
          <Card>
            <div className="p-4">
              <MerchantAddressForm
                merchantId={merchant.id}
                initial={{
                  line1: merchant.line1,
                  barangay: merchant.barangay,
                  city: merchant.city,
                  province: merchant.province,
                  postal_code: merchant.postal_code,
                  lat: latlng?.lat ?? null,
                  lng: latlng?.lng ?? null,
                }}
              />
            </div>
          </Card>
        </section>

        <Section title="Ordering">
          <Row label="Prep time" value={`${merchant.prep_time_minutes} minutes`} />
          <Row
            label="Minimum order"
            value={merchant.min_order_centavos ? formatCentavos(merchant.min_order_centavos) : "None"}
          />
          {/* Commission is set by ops, and the column grants in migration 0009
              stop a merchant writing it even if this form existed. */}
          <Row
            label="Commission"
            value={`${(Number(merchant.commission_rate) * 100).toFixed(1)}% — set by FoodDash`}
          />
        </Section>

        <section aria-labelledby="hours">
          <h2 id="hours" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">Opening hours</h2>
          <Card>
            <div className="p-4">
              <MerchantHoursEditor merchantId={merchant.id} hours={hours ?? []} />
            </div>
          </Card>
        </section>

        <section aria-labelledby="documents">
          <h2 id="documents" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">Documents</h2>
          <MerchantDocumentUpload merchantId={merchant.id} documents={docs ?? []} today={manilaTodayISO()} />
        </section>

        {(merchant.status === "draft" || merchant.status === "rejected") && (
          <section aria-labelledby="submit" className="space-y-2">
            <h2 id="submit" className="text-sm font-bold tracking-wide text-fg-muted uppercase">Go live</h2>
            <p className="text-sm text-fg-muted">
              Once your address, at least one day of opening hours and every permit above are in,
              submit your store for ops to review.
            </p>
            <SubmitForReviewButton merchantId={merchant.id} />
          </section>
        )}
        {merchant.status === "pending_review" && (
          <p className="rounded-md border border-line bg-surface px-4 py-3 text-center text-sm text-fg-muted">
            Awaiting review from FoodDash ops.
          </p>
        )}
        {merchant.status === "suspended" && (
          <p className="rounded-md border border-line bg-danger-tint px-4 py-3 text-center text-sm text-danger">
            This store is suspended and cannot take orders. Contact FoodDash support to resolve it.
          </p>
        )}

        <form action={signOut}>
          <Button type="submit" variant="secondary" fullWidth>
            Sign out
          </Button>
        </form>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">{title}</h2>
      <Card>
        <dl className="divide-y divide-line">{children}</dl>
      </Card>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="truncate text-sm font-semibold">{value}</dd>
    </div>
  );
}
