"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileCheck2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/status-pill";
import { Input } from "@/components/ui/input";
import {
  ALLOWED_DOC_TYPES,
  DOC_INFO,
  MAX_DOC_BYTES,
  requiredDocuments,
  type MerchantDocType,
} from "@/lib/domain/merchant-documents";
import { formatManilaDate } from "@/lib/format";

export interface MerchantDocument {
  id: string;
  doc_type: string;
  storage_path: string;
  status: "pending" | "approved" | "rejected" | "expired";
  review_note: string | null;
  expires_at: string | null;
  created_at: string;
}

const EXT_FOR_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

/**
 * One row per permit ops needs. Files go straight from the browser into the
 * private `documents` bucket under the store's own folder (the bucket policy
 * pins the first path segment to merchant_id), then a merchant_documents row
 * is inserted as 'pending' - merchant_documents_insert (0016) refuses
 * anything else, and refuses a path outside that folder.
 *
 * Every one of these permits lapses yearly, so every row asks for its expiry
 * up front (unlike a rider's checklist, where only the driver's licence
 * has one) - expire_stale_documents() (0017) sweeps anything left approved
 * past that date to 'expired', and approve_merchant() refuses to count it.
 */
export function MerchantDocumentUpload({
  merchantId,
  documents,
  today,
}: {
  merchantId: string;
  documents: MerchantDocument[];
  /** Server-supplied YYYY-MM-DD; the client clock is not read during render. */
  today: string;
}) {
  const required = requiredDocuments();

  const latest = (type: string) =>
    documents
      .filter((d) => d.doc_type === type)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  const approvedCount = required.filter((t) => latest(t)?.status === "approved").length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">
        {approvedCount} of {required.length} approved. Photos or scans should be clear and
        uncropped — JPEG, PNG or PDF, up to 10&nbsp;MB.
      </p>
      <ul className="space-y-2">
        {required.map((type) => (
          <li key={type}>
            <DocumentRow
              merchantId={merchantId}
              type={type}
              current={latest(type)}
              previous={documents.filter((d) => d.doc_type === type)}
              today={today}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function DocumentRow({
  merchantId,
  type,
  current,
  previous,
  today,
}: {
  merchantId: string;
  type: MerchantDocType;
  current: MerchantDocument | undefined;
  previous: MerchantDocument[];
  today: string;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [expiry, setExpiry] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const info = DOC_INFO[type];
  const approved = current?.status === "approved";

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_DOC_TYPES.includes(file.type)) {
      setError("Please upload a JPEG, PNG or PDF.");
      return;
    }
    if (file.size > MAX_DOC_BYTES) {
      setError("That file is too large - the limit is 10 MB.");
      return;
    }
    if (!expiry) {
      setError("Enter this permit's expiry date first.");
      return;
    }

    setUploading(true);
    setError(null);
    const supabase = createClient();
    const path = `${merchantId}/${type}-${crypto.randomUUID()}.${EXT_FOR_TYPE[file.type]}`;

    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(path, file, { contentType: file.type });
    if (uploadError) {
      setUploading(false);
      setError(friendlyError(uploadError));
      return;
    }

    const { error: insertError } = await supabase.from("merchant_documents").insert({
      merchant_id: merchantId,
      doc_type: type,
      storage_path: path,
      expires_at: expiry,
    });
    if (insertError) {
      await supabase.storage.from("documents").remove([path]);
      setUploading(false);
      setError(friendlyError(insertError));
      return;
    }

    // Replacing a rejected or still-pending upload: drop the old ones. An
    // approved document is ops' record and the policy would refuse anyway.
    const stale = previous.filter((d) => d.status !== "approved");
    if (stale.length > 0) {
      await supabase
        .from("merchant_documents")
        .delete()
        .in(
          "id",
          stale.map((d) => d.id),
        );
      await supabase.storage.from("documents").remove(stale.map((d) => d.storage_path));
    }

    setUploading(false);
    router.refresh();
  }

  return (
    <Card>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-bold">
              <FileCheck2 aria-hidden className="size-4 shrink-0 text-fg-muted" />
              {info.label}
            </p>
            <p className="mt-0.5 text-sm text-fg-muted">{info.hint}</p>
            {current?.expires_at && (
              <p className="mt-0.5 text-xs text-fg-muted">Expires {formatManilaDate(current.expires_at)}</p>
            )}
          </div>
          <StatusPill status={current?.status} />
        </div>

        {current?.status === "rejected" && current.review_note && (
          <p className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">
            <span className="font-semibold">Ops said:</span> {current.review_note}
          </p>
        )}

        {!approved && (
          <div className="space-y-3">
            <div>
              <label htmlFor={`expiry-${type}`} className="mb-1.5 block text-sm font-semibold">
                Expiry date
              </label>
              <Input
                id={`expiry-${type}`}
                type="date"
                min={today}
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="max-w-48"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant={current ? "secondary" : "primary"}
              loading={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {current ? "Replace file" : "Upload"}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ALLOWED_DOC_TYPES.join(",")}
              onChange={handleFile}
              className="hidden"
              aria-label={`Upload ${info.label}`}
            />
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}

function StatusPill({ status }: { status: MerchantDocument["status"] | undefined }) {
  if (!status) return <Pill tone="neutral">Not uploaded</Pill>;
  if (status === "approved") return <Pill tone="success">Approved</Pill>;
  if (status === "rejected") return <Pill tone="danger">Rejected</Pill>;
  if (status === "expired") return <Pill tone="danger">Expired</Pill>;
  return <Pill tone="active">In review</Pill>;
}
