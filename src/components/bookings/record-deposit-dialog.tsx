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
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function RecordDepositDialog({
  bookingId,
  trigger,
  open,
  onOpenChange,
}: RecordDepositDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Deposit</DialogTitle>
        </DialogHeader>
        <RecordDepositForm bookingId={bookingId} />
      </DialogContent>
    </Dialog>
  );
}
