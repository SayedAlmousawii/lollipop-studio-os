"use client";

import type { ReactElement } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { SessionTypeDepartmentOption } from "@/modules/session-types/session-type.types";
import { SessionTypeForm } from "./session-type-form";

export function SessionTypeCreateDialog({
  trigger,
  departments,
}: {
  trigger: ReactElement;
  departments: SessionTypeDepartmentOption[];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Session Type</DialogTitle>
          <DialogDescription>
            Pricing rows are created at 0 KD until the pricing page is updated.
          </DialogDescription>
        </DialogHeader>
        <SessionTypeForm mode="create" departments={departments} />
      </DialogContent>
    </Dialog>
  );
}
