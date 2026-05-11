"use client";

import type { ReactElement } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { GroupedProductOptions } from "@/modules/products/product.types";
import { PackageForm } from "./package-form";

interface PackageCreateDialogProps {
  trigger: ReactElement;
  productOptions: GroupedProductOptions[];
}

export function PackageCreateDialog({
  trigger,
  productOptions,
}: PackageCreateDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Package</DialogTitle>
        </DialogHeader>
        <PackageForm mode="create" productOptions={productOptions} />
      </DialogContent>
    </Dialog>
  );
}
