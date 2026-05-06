"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RecordBasePaymentForm } from "./record-base-payment-form";

interface RecordBasePaymentDialogProps {
  bookingId: string;
  defaultAmount: number;
  trigger: ReactNode;
}

export function RecordBasePaymentDialog({
  bookingId,
  defaultAmount,
  trigger,
}: RecordBasePaymentDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Base Payment</DialogTitle>
        </DialogHeader>
        <RecordBasePaymentForm
          bookingId={bookingId}
          defaultAmount={defaultAmount}
        />
      </DialogContent>
    </Dialog>
  );
}
