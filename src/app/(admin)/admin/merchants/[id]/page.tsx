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
  ReviewMerchantDocumentButtons,
  MerchantDecisionButtons,
  SuspendMerchantControl,
  ReactivateMerchantButton,
} from "@/components/admin/merchant-review-controls";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { DOC_INFO, requiredDocuments, type MerchantDocType } from "@/lib/domain/merchant-documents";
import { displayPhone, formatCentavos, formatManilaDate } from "@/lib/format";

export const metadata: Metadata = { title: "Merchant application" };

const STATUS_TONE = { pending: "active", approved: "success", rejected: "danger", expired: "danger" } as const;
const STATUS_LABEL = { pending: "In review", approved: "Approved", rejected: "Rejected", expired: "Expired" } as const;

const MERCHANT_STATUS_TONE = {
  approved: "success",
  pending_review: "active",
  draft: "neutral",
  suspended: "danger",
  rejected: "danger",
} as const;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function AdminMerchantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { id } = await params;
  const { profile } = await getCurrentUser();
  if (profile?.role !== "admin" && profile?.role !== "support") redirect("/");

  const supabase = await createClient();
  const { data: merchant } = await supabase
    .from("merchants")
    .select(
      "id, name, phone, email, status, rejection_reason, line1, barangay, city, province, min_order_centavos, prep_time_minutes, commission_rate, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!merchant) notFound();

  const [{ data: documents }, { data: hours }] = await Promise.all([
    supabase
      .from("merchant_documents")
      .select("id, doc_type, storage_path, status, review_note, expires_at, created_at")
      .eq("merchant_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("merchant_hours")
      .select("day_of_week, opens_at, closes_at, closes_next_day")
      .eq("merchant_id", id)
      .order("day_of_week"),
  ]);

  const required = requiredDocuments();
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
  const extraTypes = [...new Set(docs.map((d) => d.doc_type))].filter((t) => !required.includes(t as MerchantDocType));

  return (
    <>
      <RealtimeRefresh table="merchant_documents" filter={`merchant_id=eq.${id}`} />

      <ScreenHeader
        title={merchant.name}
        subtitle={merchant.status.replace(/_/g, " ")}
        backHref="/admin/merchants"
        actions={
          <Pill tone={MERCHANT_STATUS_TONE[merchant.status as keyof typeof MERCHANT_STATUS_TONE] ?? "neutral"}>
            {merchant.status.replace(/_/g, " ")}
          </Pill>
        }
      />

      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6">
        <section aria-labelledby="details">
          <h2 id="details" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">Store</h2>
          <Card>
            <dl className="divide-y divide-line text-sm">
              <Row label="Contact" value={`${displayPhone(merchant.phone)}${merchant.email ? ` · ${merchant.email}` : ""}`} />
              <Row
                label="Address"
                value={[merchant.line1, merchant.barangay, merchant.city, merchant.province].filter(Boolean).join(", ") || "—"}
              />
              <Row
                label="Hours"
                value={
                  (hours ?? []).length === 0
                    ? "None set"
                    : hours!
                        .map((h) => `${DAYS[h.day_of_week]} ${h.opens_at.slice(0, 5)}–${h.closes_at.slice(0, 5)}`)
                        .join(", ")
                }
              />
              <Row
                label="Min. order / prep time"
                value={`${merchant.min_order_centavos ? formatCentavos(merchant.min_order_centavos) : "None"} · ${merchant.prep_time_minutes} min`}
              />
              {merchant.status === "rejected" && merchant.rejection_reason && (
                <Row label="Rejected because" value={merchant.rejection_reason} />
              )}
              {merchant.status === "suspended" && merchant.rejection_reason && (
                <Row label="Suspended because" value={merchant.rejection_reason} />
              )}
            </dl>
          </Card>
        </section>

        <section aria-labelledby="docs">
          <h2 id="docs" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">Documents</h2>
          <ul className="space-y-2">
            {[...required, ...extraTypes].map((type) => {
              const doc = latest(type);
              const info = DOC_INFO[type as MerchantDocType];
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

                      {doc && doc.status !== "approved" && <ReviewMerchantDocumentButtons documentId={doc.id} />}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>

        {merchant.status === "pending_review" && (
          <section aria-labelledby="decision" className="space-y-2">
            <h2 id="decision" className="text-sm font-bold tracking-wide text-fg-muted uppercase">Decision</h2>
            <p className="text-sm text-fg-muted">
              {allApproved
                ? "Every required document is approved. Approving lists the store and lets it take orders."
                : "Approve every required document before approving the store."}
            </p>
            <MerchantDecisionButtons merchantId={id} disabled={!allApproved} />
          </section>
        )}

        {merchant.status === "approved" && (
          <section aria-labelledby="suspend" className="space-y-2">
            <h2 id="suspend" className="text-sm font-bold tracking-wide text-fg-muted uppercase">Suspend</h2>
            <SuspendMerchantControl merchantId={id} />
          </section>
        )}

        {merchant.status === "suspended" && (
          <section aria-labelledby="reactivate" className="space-y-2">
            <h2 id="reactivate" className="text-sm font-bold tracking-wide text-fg-muted uppercase">Suspended</h2>
            <p className="text-sm text-fg-muted">
              {allApproved
                ? "Every required document is still approved and current. Reactivating puts the store back on the map."
                : "A required document is missing or has expired since this store was suspended - re-approve it before reactivating."}
            </p>
            <ReactivateMerchantButton merchantId={id} />
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
