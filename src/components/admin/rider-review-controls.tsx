"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

/**
 * Approve or reject one uploaded document. Both go through
 * review_rider_document (0015) - it is admin-only, refuses a rejection with
 * no reason (the rider reads that note to know what to fix), and writes the
 * audit log row in the same transaction.
 */
export function ReviewDocumentButtons({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [rejecting, setRejecting] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<"approve" | "reject" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function review(approve: boolean) {
    setBusy(approve ? "approve" : "reject");
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("review_rider_document", {
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
          <label htmlFor={`reject-${documentId}`} className="block text-sm font-semibold">
            Why is it being rejected?
          </label>
          <Textarea
            id={`reject-${documentId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="e.g. Photo is blurry - please retake it in good light."
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
 * verify_rider refuses unless every document this vehicle needs is approved
 * and unexpired, and says which are missing - so the button can be offered
 * optimistically and the message is the real answer.
 */
export function VerifyRiderButton({ riderId, disabled }: { riderId: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("verify_rider", { p_rider_id: riderId });
    setBusy(false);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button loading={busy} disabled={disabled} onClick={verify}>
        Verify rider
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * suspend_rider/unsuspend_rider (0018). set_rider_availability and dispatch
 * (0008/0010) already refuse a suspended rider, so this is the entire
 * enforcement - a mid-delivery rider is left to finish that one job rather
 * than stranding whoever is waiting on it (see the RPC's own comment).
 */
export function SuspendRiderControl({ riderId }: { riderId: string }) {
  const router = useRouter();
  const [suspending, setSuspending] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function suspend() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("suspend_rider", { p_rider_id: riderId, p_reason: reason });
    setBusy(false);
    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    router.refresh();
  }

  if (!suspending) {
    return <Button variant="danger" onClick={() => setSuspending(true)}>Suspend rider</Button>;
  }

  return (
    <div className="space-y-2 rounded-md border border-line bg-surface p-3">
      <label htmlFor={`suspend-rider-${riderId}`} className="block text-sm font-semibold">
        Why is this rider being suspended?
      </label>
      <Textarea
        id={`suspend-rider-${riderId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="e.g. Multiple customer complaints of unsafe driving."
      />
      <div className="flex gap-2">
        <Button size="sm" variant="danger" loading={busy} disabled={!reason.trim() || busy} onClick={suspend}>
          Suspend rider
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

export function UnsuspendRiderButton({ riderId }: { riderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function unsuspend() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("unsuspend_rider", { p_rider_id: riderId });
    setBusy(false);
    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button loading={busy} onClick={unsuspend}>
        Lift suspension
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
