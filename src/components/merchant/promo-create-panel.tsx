"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PromoForm } from "./promo-form";

export function PromoCreatePanel({ merchantId }: { merchantId: string }) {
  const [open, setOpen] = React.useState(false);

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> New promo
        </Button>
      </div>
    );
  }

  return <PromoForm merchantId={merchantId} onDone={() => setOpen(false)} />;
}
