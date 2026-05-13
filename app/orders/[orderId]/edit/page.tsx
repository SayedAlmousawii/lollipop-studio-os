import { redirect } from "next/navigation";

export default async function EditOrderPage(
  props: PageProps<"/orders/[orderId]/edit">
) {
  const { orderId } = await props.params;
  redirect(`/orders/${orderId}/sales`);
}
