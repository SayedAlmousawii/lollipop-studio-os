import { MoreHorizontal } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Product } from "@/modules/products/product.types";
import { ProductArchiveButton } from "./product-archive-button";
import { ProductEditDialog } from "./product-edit-dialog";
import { ProductStatusBadge } from "./product-status-badge";

interface ProductsTableProps {
  products: Product[];
}

export function ProductsTable({ products }: ProductsTableProps) {
  if (products.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-surface px-6 py-10 text-center">
        <p className="text-sm font-medium text-text-primary">
          No products yet
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Create canonical deliverables before building structured packages.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-surface-soft">
            <TableHead className="text-text-secondary">Name</TableHead>
            <TableHead className="text-text-secondary">Category</TableHead>
            <TableHead className="text-text-secondary">Canonical Price</TableHead>
            <TableHead className="text-text-secondary">Use</TableHead>
            <TableHead className="text-text-secondary">Status</TableHead>
            <TableHead className="text-text-secondary">Package Uses</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow
              key={product.id}
              className="border-border hover:bg-surface-soft"
            >
              <TableCell className="font-medium text-text-primary">
                <div>{product.name}</div>
                {product.description ? (
                  <p className="mt-1 max-w-md text-xs font-normal text-text-secondary">
                    {product.description}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {product.categoryLabel}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {product.canonicalPrice}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {product.isPackageDeliverable && product.isAddOn
                  ? "Package + Add-on"
                  : product.isAddOn
                    ? "Add-on"
                    : "Package"}
              </TableCell>
              <TableCell>
                <ProductStatusBadge status={product.status} />
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {product.packageItemCount}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "icon" }),
                      "h-8 w-8"
                    )}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Open actions</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <ProductEditDialog product={product} />
                    <ProductArchiveButton
                      productId={product.id}
                      packageItemCount={product.packageItemCount}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
