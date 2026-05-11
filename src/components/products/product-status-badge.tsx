import type { ProductStatus } from "@/modules/products/product.types";

const styles: Record<ProductStatus, string> = {
  Active: "bg-success-soft text-success",
  Inactive: "bg-danger-soft text-danger",
};

interface ProductStatusBadgeProps {
  status: ProductStatus;
}

export function ProductStatusBadge({ status }: ProductStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
