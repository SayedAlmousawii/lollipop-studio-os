import type { OrderStatusLabel } from "@/modules/orders/order.types";

const styles: Record<OrderStatusLabel, string> = {
  "Active":               "bg-info-soft text-info",
  "Waiting Selection":    "bg-warning-soft text-warning",
  "Selection Completed":  "bg-warning-soft text-warning",
  "Editing":              "bg-warning-soft text-warning",
  "Production":           "bg-info-soft text-info",
  "Ready":                "bg-success-soft text-success",
  "Delivered":            "bg-success-soft text-success",
  "Cancelled":            "bg-danger-soft text-danger",
};

interface OrderStatusBadgeProps {
  status: OrderStatusLabel;
}

export function OrderStatusBadge({ status }: OrderStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
