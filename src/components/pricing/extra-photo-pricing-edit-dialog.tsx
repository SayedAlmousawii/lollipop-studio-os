"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ExtraPhotoPricingRow } from "@/modules/pricing/pricing.types";
import { ExtraPhotoPricingForm } from "./extra-photo-pricing-form";

interface ExtraPhotoPricingEditDialogProps {
  row: ExtraPhotoPricingRow;
}

export function ExtraPhotoPricingEditDialog({
  row,
}: ExtraPhotoPricingEditDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start px-2 py-1.5 text-sm font-normal"
        >
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Extra-Photo Prices</DialogTitle>
          <DialogDescription>
            Set digital and print prices for this session type together.
          </DialogDescription>
        </DialogHeader>
        <ExtraPhotoPricingForm row={row} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
