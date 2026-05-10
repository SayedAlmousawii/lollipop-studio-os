"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RecordUpgradePaymentForm } from "./record-upgrade-payment-form";

interface RecordUpgradePaymentDialogProps {
  orderId: string;
  invoiceId: string;
  defaultAmount: number;
  trigger: ReactNode;
}

export function RecordUpgradePaymentDialog({
  orderId,
  invoiceId,
  defaultAmount,
  trigger,
}: RecordUpgradePaymentDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Upgrade Payment</DialogTitle>
        </DialogHeader>
        <RecordUpgradePaymentForm
          orderId={orderId}
          invoiceId={invoiceId}
          defaultAmount={defaultAmount}
        />
      </DialogContent>
    </Dialog>
  );
}
