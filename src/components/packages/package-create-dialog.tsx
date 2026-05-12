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
import type { GroupedProductOptions } from "@/modules/products/product.types";
import type { PackageTaxonomyOptions } from "@/modules/packages/package.types";
import { PackageForm } from "./package-form";

interface PackageCreateDialogProps {
  trigger: ReactElement;
  productOptions: GroupedProductOptions[];
  taxonomyOptions: PackageTaxonomyOptions;
}

export function PackageCreateDialog({
  trigger,
  productOptions,
  taxonomyOptions,
}: PackageCreateDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="grid h-[85dvh] w-[96vw] max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>Create Package</DialogTitle>
          <DialogDescription className="sr-only">
            Create a package with pricing, photo count, and structured deliverable items.
          </DialogDescription>
        </DialogHeader>
        <PackageForm
          mode="create"
          productOptions={productOptions}
          taxonomyOptions={taxonomyOptions}
        />
      </DialogContent>
    </Dialog>
  );
}
