import { PageContainer } from "@/components/layout/page-container";
import { OrdersFilters } from "@/components/orders/orders-filters";
import { OrdersTable } from "@/components/orders/orders-table";
import type { Order } from "@/modules/orders/order.types";

const MOCK_ORDERS: Order[] = [
  {
    id: "ord-001",
    customerName: "Sara Al-Rashidi",
    packageName: "Premium Family Session",
    orderStatus: "Active",
    invoiceTotal: "150.000 KD",
    paidAmount: "75.000 KD",
    remainingAmount: "75.000 KD",
    invoiceStatus: "Partial",
    paymentMethod: "KNET",
    createdAt: "10 Jan 2026",
  },
  {
    id: "ord-002",
    customerName: "Mohammed Al-Enezi",
    packageName: "Newborn Classic",
    orderStatus: "Awaiting Selection",
    invoiceTotal: "90.000 KD",
    paidAmount: "0.000 KD",
    remainingAmount: "90.000 KD",
    invoiceStatus: "Unpaid",
    paymentMethod: "—",
    createdAt: "15 Jan 2026",
  },
  {
    id: "ord-003",
    customerName: "Fatima Al-Sabah",
    packageName: "Wedding Deluxe",
    orderStatus: "In Production",
    invoiceTotal: "250.000 KD",
    paidAmount: "250.000 KD",
    remainingAmount: "0.000 KD",
    invoiceStatus: "Paid",
    paymentMethod: "Cash",
    createdAt: "20 Jan 2026",
  },
  {
    id: "ord-004",
    customerName: "Khalid Al-Muqrin",
    packageName: "Corporate Headshots",
    orderStatus: "Delivered",
    invoiceTotal: "120.000 KD",
    paidAmount: "120.000 KD",
    remainingAmount: "0.000 KD",
    invoiceStatus: "Paid",
    paymentMethod: "Link",
    createdAt: "25 Jan 2026",
  },
  {
    id: "ord-005",
    customerName: "Noura Al-Hamad",
    packageName: "Maternity Bloom",
    orderStatus: "Editing",
    invoiceTotal: "85.000 KD",
    paidAmount: "85.000 KD",
    remainingAmount: "0.000 KD",
    invoiceStatus: "Refunded",
    paymentMethod: "KNET",
    createdAt: "01 Feb 2026",
  },
  {
    id: "ord-006",
    customerName: "Jassim Al-Bahar",
    packageName: "Studio Portrait",
    orderStatus: "Cancelled",
    invoiceTotal: "60.000 KD",
    paidAmount: "0.000 KD",
    remainingAmount: "60.000 KD",
    invoiceStatus: "Unpaid",
    paymentMethod: "—",
    createdAt: "05 Feb 2026",
  },
];

export default async function OrdersPage() {
  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold text-text-primary">
              Orders
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Manage orders, invoices, and payment records.
            </p>
          </div>
        </div>

        <OrdersFilters />

        <OrdersTable orders={MOCK_ORDERS} />
      </div>
    </PageContainer>
  );
}
