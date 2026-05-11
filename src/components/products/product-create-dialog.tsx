"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ProductForm } from "./product-form";

interface ProductCreateDialogProps {
  trigger: ReactNode;
}

export function ProductCreateDialog({ trigger }: ProductCreateDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Product</DialogTitle>
        </DialogHeader>
        <ProductForm mode="create" />
      </DialogContent>
    </Dialog>
  );
}
