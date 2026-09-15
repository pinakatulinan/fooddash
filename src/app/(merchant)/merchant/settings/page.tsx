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
import { signOut } from "@/app/(auth)/actions";
import { formatCentavos, displayPhone } from "@/lib/format";

export const metadata: Metadata = { title: "Store settings" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
  const [{ data: hours }, { data: docs }] = await Promise.all([
    supabase
      .from("merchant_hours")
      .select("id, day_of_week, opens_at, closes_at, closes_next_day")
      .eq("merchant_id", merchant.id)
      .order("day_of_week"),
    supabase
      .from("merchant_documents")
      .select("id, doc_type, status, expires_at")
      .eq("merchant_id", merchant.id),
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
          {merchant.status === "rejected" && merchant.rejection_reason && (
            <Row label="Why" value={merchant.rejection_reason} />
          )}
          <Row label="Phone" value={displayPhone(merchant.phone)} />
          <Row
            label="Address"
            value={
              [merchant.line1, merchant.barangay, merchant.city, merchant.province]
                .filter(Boolean)
                .join(", ") || "—"
            }
          />
        </Section>

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

        <Section title="Opening hours">
          {(hours ?? []).length === 0 ? (
            <p className="px-4 py-3 text-sm text-fg-muted">
              No hours set — the store will read as closed to customers.
            </p>
          ) : (
            hours!.map((h) => (
              <Row
                key={h.id}
                label={DAYS[h.day_of_week]}
                value={`${h.opens_at.slice(0, 5)} – ${h.closes_at.slice(0, 5)}${
                  h.closes_next_day ? " (next day)" : ""
                }`}
              />
            ))
          )}
        </Section>

        <Section title="Documents">
          {(docs ?? []).length === 0 ? (
            <p className="px-4 py-3 text-sm text-fg-muted">
              No permits uploaded. Ops reviews business permit, BIR registration and sanitary permit
              before a store goes live.
            </p>
          ) : (
            docs!.map((d) => (
              <Row key={d.id} label={d.doc_type.replace(/_/g, " ")} value={d.status} />
            ))
          )}
        </Section>

        <p className="text-center text-sm text-fg-muted">
          Editing opening hours and documents is the next piece of the merchant console.
        </p>

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
