import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { EditOrderForm } from "@/components/orders/edit-order-form";
import { getEditableOrderById } from "@/modules/orders/order.service";
import { getActivePackageOptions } from "@/modules/packages/package.service";

export default async function EditOrderPage(
  props: PageProps<"/orders/[orderId]/edit">
) {
  const { orderId } = await props.params;
  const [order, packages] = await Promise.all([
    getEditableOrderById(orderId),
    getActivePackageOptions(),
  ]);

  if (!order) notFound();

  return (
    <PageContainer>
      <EditOrderForm order={order} packages={packages} />
    </PageContainer>
  );
}
