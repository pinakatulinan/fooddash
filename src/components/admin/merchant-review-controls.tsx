"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

/**
 * Approve or reject one uploaded document. Both go through
 * review_merchant_document (0016) - admin-only, refuses a rejection with no
 * reason, and writes the audit log row in the same transaction.
 */
export function ReviewMerchantDocumentButtons({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [rejecting, setRejecting] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<"approve" | "reject" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function review(approve: boolean) {
    setBusy(approve ? "approve" : "reject");
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("review_merchant_document", {
      p_document_id: documentId,
      p_approve: approve,
      p_note: approve ? null : note,
    });
    setBusy(null);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="mint" loading={busy === "approve"} disabled={busy !== null} onClick={() => review(true)}>
          Approve
        </Button>
        {!rejecting && (
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => setRejecting(true)}>
            Reject
          </Button>
        )}
      </div>

      {rejecting && (
        <div className="space-y-2 rounded-md border border-line bg-surface p-3">
          <label htmlFor={`reject-doc-${documentId}`} className="block text-sm font-semibold">
            Why is it being rejected?
          </label>
          <Textarea
            id={`reject-doc-${documentId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="e.g. Permit has expired - please upload a current one."
          />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" loading={busy === "reject"} disabled={!note.trim() || busy !== null} onClick={() => review(false)}>
              Reject document
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * approve_merchant refuses unless every required document is approved and
 * the store is actually awaiting review, and says which are missing - so the
 * button can be offered optimistically and the message is the real answer.
 * reject_merchant needs a reason the same way review_merchant_document does.
 */
export function MerchantDecisionButtons({ merchantId, disabled }: { merchantId: string; disabled?: boolean }) {
  const router = useRouter();
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState<"approve" | "reject" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function approve() {
    setBusy("approve");
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("approve_merchant", { p_merchant_id: merchantId });
    setBusy(null);
    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    router.refresh();
  }

  async function reject() {
    setBusy("reject");
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("reject_merchant", { p_merchant_id: merchantId, p_reason: reason });
    setBusy(null);
    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button loading={busy === "approve"} disabled={disabled || busy !== null} onClick={approve}>
          Approve store
        </Button>
        {!rejecting && (
          <Button variant="secondary" disabled={busy !== null} onClick={() => setRejecting(true)}>
            Reject
          </Button>
        )}
      </div>

      {rejecting && (
        <div className="space-y-2 rounded-md border border-line bg-surface p-3">
          <label htmlFor={`reject-merchant-${merchantId}`} className="block text-sm font-semibold">
            Why is it being rejected?
          </label>
          <Textarea
            id={`reject-merchant-${merchantId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. Sanitary permit does not match this address."
          />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" loading={busy === "reject"} disabled={!reason.trim() || busy !== null} onClick={reject}>
              Reject store
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * suspend_merchant/reactivate_merchant (0018). Suspending is the same shape
 * as rejecting - a required reason, audit-logged - because is_merchant_open()
 * already refuses a non-'approved' store, so flipping the status is the whole
 * enforcement; nothing else needs to change. Reactivating is held to the same
 * bar as approving: a permit that lapsed while suspended still blocks it.
 */
export function SuspendMerchantControl({ merchantId }: { merchantId: string }) {
  const router = useRouter();
  const [suspending, setSuspending] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function suspend() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("suspend_merchant", { p_merchant_id: merchantId, p_reason: reason });
    setBusy(false);
    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    router.refresh();
  }

  if (!suspending) {
    return <Button variant="danger" onClick={() => setSuspending(true)}>Suspend store</Button>;
  }

  return (
    <div className="space-y-2 rounded-md border border-line bg-surface p-3">
      <label htmlFor={`suspend-merchant-${merchantId}`} className="block text-sm font-semibold">
        Why is it being suspended?
      </label>
      <Textarea
        id={`suspend-merchant-${merchantId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="e.g. Repeated food safety complaints under investigation."
      />
      <div className="flex gap-2">
        <Button size="sm" variant="danger" loading={busy} disabled={!reason.trim() || busy} onClick={suspend}>
          Suspend store
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSuspending(false)}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function ReactivateMerchantButton({ merchantId }: { merchantId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function reactivate() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("reactivate_merchant", { p_merchant_id: merchantId });
    setBusy(false);
    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button loading={busy} onClick={reactivate}>
        Reactivate store
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
