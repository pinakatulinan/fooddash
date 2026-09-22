"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * submit_merchant_for_review (0016) is the only way draft/rejected moves to
 * pending_review, and it re-checks everything itself - the error it returns
 * says exactly what's still missing, so there is nothing to validate here.
 */
export function SubmitForReviewButton({ merchantId }: { merchantId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("submit_merchant_for_review", { p_merchant_id: merchantId });
    setBusy(false);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button loading={busy} onClick={submit} fullWidth>
        Submit for review
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
