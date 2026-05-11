import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Product } from "@/modules/products/product.types";
import { ProductForm } from "./product-form";

interface ProductEditDialogProps {
  product: Product;
}

export function ProductEditDialog({ product }: ProductEditDialogProps) {
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Product</DialogTitle>
        </DialogHeader>
        <ProductForm
          mode="edit"
          productId={product.id}
          defaultValues={{
            name: product.name,
            category: product.category,
            canonicalPrice: product.canonicalPriceValue.toFixed(3),
            description: product.description,
            isActive: product.isActive ? "on" : "",
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
