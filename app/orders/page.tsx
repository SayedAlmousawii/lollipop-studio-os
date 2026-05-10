import { PageContainer } from "@/components/layout/page-container";
import { OrdersFilters } from "@/components/orders/orders-filters";
import { OrdersTable } from "@/components/orders/orders-table";
import {
  getOrderFilterEditorOptions,
  getOrders,
  parseOrderFilters,
} from "@/modules/orders/order.service";

export default async function OrdersPage(props: PageProps<"/orders">) {
  const filters = parseOrderFilters(await props.searchParams);
  const [orders, editorOptions] = await Promise.all([
    getOrders(filters),
    getOrderFilterEditorOptions(),
  ]);

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

        <OrdersFilters currentFilters={filters} editorOptions={editorOptions} />

        <OrdersTable orders={orders} />
      </div>
    </PageContainer>
  );
}
