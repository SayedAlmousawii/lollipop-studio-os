import { PageContainer } from "@/components/layout/page-container";
import { EditingQueueTable } from "@/components/editing/editing-queue-table";
import { getEditingQueue } from "@/modules/orders/order.service";
import { requireCurrentAppUserPermission, PERMISSIONS } from "@/lib/permissions";

export default async function EditingPage() {
  await requireCurrentAppUserPermission(PERMISSIONS.WORKFLOW_EDITING_UPDATE);

  const items = await getEditingQueue();

  return (
    <PageContainer>
      <div className="space-y-6">
        <div>
          <h1 className="text-[28px] font-semibold text-text-primary">
            Editing Queue
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Orders currently in the editing stage.
          </p>
        </div>

        <EditingQueueTable items={items} />
      </div>
    </PageContainer>
  );
}
