"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RecordDepositForm } from "./record-deposit-form";

interface RecordDepositDialogProps {
  bookingId: string;
  trigger: ReactNode;
}

export function RecordDepositDialog({
  bookingId,
  trigger,
}: RecordDepositDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Deposit</DialogTitle>
        </DialogHeader>
        <RecordDepositForm bookingId={bookingId} />
      </DialogContent>
    </Dialog>
  );
}
