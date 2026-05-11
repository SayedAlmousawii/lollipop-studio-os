import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Package } from "@/modules/packages/package.types";
import type { GroupedProductOptions } from "@/modules/products/product.types";
import { PackageForm } from "./package-form";

interface PackageEditDialogProps {
  packageRecord: Package;
  productOptions: GroupedProductOptions[];
}

export function PackageEditDialog({
  packageRecord,
  productOptions,
}: PackageEditDialogProps) {
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
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Package</DialogTitle>
        </DialogHeader>
        <PackageForm
          mode="edit"
          packageId={packageRecord.id}
          productOptions={productOptions}
          defaultValues={{
            name: packageRecord.name,
            price: packageRecord.priceValue.toFixed(3),
            photoCount: String(packageRecord.photoCount),
            description: packageRecord.description,
            isActive: packageRecord.isActive ? "on" : "",
            items: packageRecord.items.map((item, index) => ({
              productId: item.productId,
              quantity: String(item.quantity),
              priceSnapshot: item.priceSnapshotValue.toFixed(3),
              sortOrder: String(index),
            })),
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
