"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { ReportProblemForm } from "./report-problem-form";

export function ReportProblemPanel({ orderId, customerId }: { orderId: string; customerId: string }) {
  const [open, setOpen] = React.useState(false);

  if (!open) {
    return (
      <Button variant="secondary" fullWidth onClick={() => setOpen(true)}>
        Report a problem
      </Button>
    );
  }

  return <ReportProblemForm orderId={orderId} customerId={customerId} onDone={() => setOpen(false)} />;
}
