"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  SessionConfigurationDetail,
  SessionConfigurationProductOption,
  SessionConfigurationSessionTypeOption,
} from "@/modules/session-configurations/session-configuration.types";
import { SessionConfigurationForm } from "./session-configuration-form";

export function SessionConfigurationEditDialog({
  configuration,
  sessionTypes,
  products,
}: {
  configuration: SessionConfigurationDetail;
  sessionTypes: SessionConfigurationSessionTypeOption[];
  products: SessionConfigurationProductOption[];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start px-2 py-1.5 text-sm font-normal"
        >
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Configuration</DialogTitle>
        </DialogHeader>
        <SessionConfigurationForm
          mode="edit"
          sessionTypes={sessionTypes}
          products={products}
          configuration={configuration}
        />
      </DialogContent>
    </Dialog>
  );
}
