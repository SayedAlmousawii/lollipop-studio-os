import { PageContainer } from "@/components/layout/page-container";
import { ProductionQueueTable } from "@/components/production/production-queue-table";
import { requireCurrentAppUserPermission, PERMISSIONS } from "@/lib/permissions";
import { getProductionQueue } from "@/modules/orders/order.service";

export default async function ProductionPage() {
  await requireCurrentAppUserPermission(PERMISSIONS.ORDER_READ);

  const items = await getProductionQueue();

  return (
    <PageContainer>
      <div className="space-y-6">
        <div>
          <h1 className="text-[28px] font-semibold text-text-primary">
            Production Queue
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Orders currently moving through production.
          </p>
        </div>

        <ProductionQueueTable items={items} />
      </div>
    </PageContainer>
  );
}
