"use client";

import type { ReactNode } from "react";
import type { CustomerStatus } from "@prisma/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CustomerForm } from "./customer-form";

interface CustomerEditDialogProps {
  customer: {
    id: string;
    name: string;
    phone: string;
    notes: string;
    status: CustomerStatus;
  };
  returnTo: string;
  trigger: ReactNode;
}

export function CustomerEditDialog({
  customer,
  returnTo,
  trigger,
}: CustomerEditDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Customer</DialogTitle>
        </DialogHeader>
        <CustomerForm
          mode="edit"
          variant="dialog"
          customerId={customer.id}
          defaultValues={{
            name: customer.name,
            phone: customer.phone,
            notes: customer.notes,
            status: customer.status,
          }}
          returnTo={returnTo}
        />
      </DialogContent>
    </Dialog>
  );
}
