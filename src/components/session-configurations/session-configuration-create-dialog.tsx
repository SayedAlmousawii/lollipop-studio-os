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
import type {
  SessionConfigurationProductOption,
  SessionConfigurationSessionTypeOption,
} from "@/modules/session-configurations/session-configuration.types";
import { SessionConfigurationForm } from "./session-configuration-form";

export function SessionConfigurationCreateDialog({
  trigger,
  sessionTypes,
  products,
}: {
  trigger: ReactElement;
  sessionTypes: SessionConfigurationSessionTypeOption[];
  products: SessionConfigurationProductOption[];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Configuration</DialogTitle>
          <DialogDescription>
            Create a session setup field for staff to use later during order setup.
          </DialogDescription>
        </DialogHeader>
        <SessionConfigurationForm
          mode="create"
          sessionTypes={sessionTypes}
          products={products}
        />
      </DialogContent>
    </Dialog>
  );
}
