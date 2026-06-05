import { redirect } from "next/navigation";

export default async function AdjustmentWorkspacePage(
  props: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await props.params;
  console.info(
    JSON.stringify({
      metric: "adjustment_workspace.route_redirected",
      orderId,
    })
  );
  redirect(`/orders/${orderId}/sales`);
}
